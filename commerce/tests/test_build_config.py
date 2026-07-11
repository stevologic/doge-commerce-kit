import json
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from django.core.management import call_command
from django.test import Client, SimpleTestCase


ROOT = Path(__file__).resolve().parents[2]


class BuildConfigTests(SimpleTestCase):
    def test_requirements_txt_contains_only_runtime_packages(self):
        lines = [
            line.strip()
            for line in (ROOT / "requirements.txt").read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.strip().startswith("#")
        ]
        self.assertEqual(
            lines,
            [
                "Django>=5.1,<6.0",
                "gunicorn>=23.0,<24.0",
                "whitenoise>=6.8,<7.0",
                "qrcode>=8.0,<9.0",
            ],
        )

    def test_requirements_dev_includes_test_packages(self):
        dev = (ROOT / "requirements-dev.txt").read_text(encoding="utf-8")
        self.assertIn("-r requirements.txt", dev)
        for package in ("ecdsa", "py-mini-racer", "playwright"):
            self.assertIn(package, dev)

    def test_dockerfile_runs_collectstatic_and_gunicorn(self):
        dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
        self.assertIn("pip install", dockerfile)
        self.assertIn("collectstatic --noinput", dockerfile)
        self.assertIn("gunicorn", dockerfile)
        self.assertIn("42069", dockerfile)

    def test_docker_compose_exposes_health_port(self):
        compose = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
        self.assertIn("42069:42069", compose)
        self.assertIn("build: .", compose)

    def test_health_endpoint_returns_ok_json(self):
        client = Client()
        response = client.get("/health/")
        self.assertEqual(response.status_code, 200)
        payload = json.loads(response.content)
        self.assertEqual(payload["status"], "ok")

    def test_verify_build_script_declares_verification_artifacts(self):
        script = (ROOT / "tools" / "verify_build.py").read_text(encoding="utf-8")
        for artifact in (
            "pip-requirements.log",
            'f"docker-build-{index}.log"',
            "docker-build.log",
            "local-django-build.log",
            "docker-compose-up.log",
            "--no-cache",
            "DOGE2MOON_SCRATCH",
        ):
            self.assertIn(artifact, script)

    def test_local_django_check_and_collectstatic_succeed(self):
        out = StringIO()
        with patch("sys.stdout", out):
            call_command("check")
            call_command("collectstatic", "--noinput", verbosity=1)
        output = out.getvalue()
        self.assertIn("System check identified no issues", output)
        self.assertRegex(output, r"static files copied|unmodified")