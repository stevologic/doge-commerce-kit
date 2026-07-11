#!/usr/bin/env python
"""Django command-line utility for DOGE2MOON."""
import os
import sys


def main():
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "doge2moon.settings")
    from django.core.management import execute_from_command_line

    execute_from_command_line(sys.argv)


if __name__ == "__main__":
    main()
