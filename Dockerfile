FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
RUN python manage.py collectstatic --noinput

RUN useradd --create-home --shell /usr/sbin/nologin appuser \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 42069

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:42069/health/', timeout=4).status == 200 else 1)"]

CMD ["gunicorn", "doge2moon.wsgi:application", \
     "--bind", "0.0.0.0:42069", \
     "--workers", "3", \
     "--threads", "4", \
     "--timeout", "30", \
     "--graceful-timeout", "20", \
     "--access-logfile", "-", \
     "--error-logfile", "-"]
