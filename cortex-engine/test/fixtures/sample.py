"""Sample Python file for tree-sitter parsing tests."""

import os
from pathlib import Path
from typing import List, Optional


MAX_RETRIES = 3


class Animal:
    """A base animal class."""

    def __init__(self, name: str, age: int = 0):
        self.name = name
        self.age = age

    def speak(self) -> str:
        return "..."

    async def fetch_data(self) -> dict:
        return {}


class Dog(Animal):
    """A dog that extends Animal."""

    def speak(self) -> str:
        return "Woof!"

    def fetch(self, item: str) -> str:
        return f"Fetched {item}"


@staticmethod
def decorated_function():
    """A decorated standalone function."""
    pass


async def async_standalone(url: str) -> Optional[dict]:
    """An async standalone function."""
    return None
