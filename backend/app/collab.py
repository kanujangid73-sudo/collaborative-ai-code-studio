"""Collaborative code documents.

Each file is a Yjs CRDT document (via pycrdt). Clients send binary updates; the server
merges them into its copy, relays them to the rest of the room and saves the merged state
to the database periodically. Because CRDT merges are order-independent, people can type
in the same file at the same time without overwriting each other.
"""

import asyncio
import logging

from pycrdt import Doc, Text
from sqlmodel import Session

from . import database
from .models import CodeFile, utcnow

logger = logging.getLogger("codetogether.collab")

TEXT_KEY = "code"  # must match the Y.Text name used by the frontend
FLUSH_SECONDS = 2.0
MAX_UPDATE_BYTES = 512 * 1024

STARTER_CODE = '''# Welcome to the shared editor!
# Everyone in this workspace sees changes live, with named cursors.
# Select some code and press "Ask AI" to get help from the assistant.


def greet(name: str) -> str:
    return f"Hello, {name}! Let's build something together."


print(greet("team"))
'''


def new_state(initial_text: str = "") -> bytes:
    doc = Doc()
    doc[TEXT_KEY] = Text(initial_text)
    return doc.get_update()


def starter_file(workspace_id: int, user_id: int | None = None) -> CodeFile:
    return CodeFile(workspace_id=workspace_id, name="main.py", ydoc=new_state(STARTER_CODE), created_by=user_id)


class DocStore:
    def __init__(self) -> None:
        self.docs: dict[int, Doc] = {}
        self.dirty: set[int] = set()
        self._task: asyncio.Task | None = None

    def _load(self, file_id: int) -> Doc | None:
        if file_id in self.docs:
            return self.docs[file_id]
        with Session(database.engine) as session:
            row = session.get(CodeFile, file_id)
            if row is None:
                return None
            state = row.ydoc
        doc = Doc()
        doc[TEXT_KEY] = Text()
        if state:
            doc.apply_update(state)
        self.docs[file_id] = doc
        return doc

    def state(self, file_id: int) -> bytes | None:
        doc = self._load(file_id)
        return doc.get_update() if doc else None

    def apply(self, file_id: int, update: bytes) -> bool:
        if len(update) > MAX_UPDATE_BYTES:
            return False
        doc = self._load(file_id)
        if doc is None:
            return False
        try:
            doc.apply_update(update)
        except Exception:  # malformed update from a client
            logger.warning("Rejected malformed update for file %s", file_id)
            return False
        self.dirty.add(file_id)
        return True

    def text(self, file_id: int) -> str:
        doc = self._load(file_id)
        return str(doc[TEXT_KEY]) if doc else ""

    def forget(self, file_id: int) -> None:
        self.docs.pop(file_id, None)
        self.dirty.discard(file_id)

    def flush(self) -> None:
        if not self.dirty:
            return
        pending, self.dirty = self.dirty, set()
        with Session(database.engine) as session:
            for file_id in pending:
                row = session.get(CodeFile, file_id)
                doc = self.docs.get(file_id)
                if row is None or doc is None:
                    continue
                row.ydoc = doc.get_update()
                row.updated_at = utcnow()
                session.add(row)
            session.commit()

    async def _flush_loop(self) -> None:
        while True:
            await asyncio.sleep(FLUSH_SECONDS)
            try:
                self.flush()
            except Exception:
                logger.exception("Saving documents failed")

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._flush_loop())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            self._task = None
        self.flush()


store = DocStore()
