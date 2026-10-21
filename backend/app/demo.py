"""One-click demo accounts.

A visitor gets a temporary guest user and a private workspace filled with sample files, so
they can try the editor, the code runner and the AI without signing up. Guests and
everything they own are deleted after settings.guest_ttl_hours.
"""

import logging
import secrets
from datetime import timedelta

from sqlmodel import Session, delete, select, update

from .collab import new_state, store
from .config import settings
from .models import CodeFile, Message, User, Workspace, WorkspaceMember, utcnow
from .security import hash_password

logger = logging.getLogger("codetogether.demo")

DEMO_FILES = {
    "README.md": """# Welcome to CodeTogether

This is your own demo workspace. Try these:

1. **Run code.** Open `main.py` and press **Run**. It crashes on purpose.
   Click **Ask AI to fix** and the AI explains the bug and suggests a fix.
2. **Ask about code.** Select a few lines and press **Ask AI** (or Ctrl+Enter).
   The answer appears in the chat, and you can insert its code into the editor.
3. **Collaborate live.** Open the **General** workspace, then open the app in a
   second browser window (or send the link to a friend) and try the demo there too.
   Type in the same file and watch each other's cursors.
4. **JavaScript works too.** Open `app.js` and press **Run**.

This guest account and its workspace are deleted after 24 hours.
Sign up for a free account to keep your work.
""",
    "main.py": """# Press Run. There's a bug in here: click "Ask AI to fix" when it fails.


def average(numbers):
    return sum(numbers) / len(numbers)


scores = {"alice": [90, 85, 77], "bob": [], "carol": [68, 94]}

for name, values in scores.items():
    print(f"{name}: {average(values):.1f}")
""",
    "app.js": """// JavaScript runs in your browser too. Press Run.
const words = ["build", "better", "code", "together"];

const title = words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
console.log(title);
console.log(`${words.length} words, ${title.length} characters`);
""",
}


def _guest_name(session: Session) -> str:
    while True:
        name = f"guest_{secrets.token_hex(3)}"
        if not session.exec(select(User).where(User.username == name)).first():
            return name


def create_guest(session: Session) -> tuple[User, Workspace]:
    # Nobody knows this password, so the account can only be used through the issued token.
    user = User(username=_guest_name(session), password_hash=hash_password(secrets.token_urlsafe(32)), is_guest=True)
    session.add(user)
    session.flush()
    workspace = Workspace(
        name="Demo workspace",
        description="Your private sandbox. Start with README.md",
        owner_id=user.id,
        is_private=True,
    )
    session.add(workspace)
    session.flush()
    for name, text in DEMO_FILES.items():
        session.add(CodeFile(workspace_id=workspace.id, name=name, ydoc=new_state(text), created_by=user.id))
    session.commit()
    session.refresh(user)
    session.refresh(workspace)
    return user, workspace


def purge_expired_guests(session: Session) -> int:
    """Delete guests older than the TTL with their workspaces, memberships and messages."""
    cutoff = utcnow() - timedelta(hours=settings.guest_ttl_hours)
    guest_ids = list(session.exec(select(User.id).where(User.is_guest == True, User.created_at < cutoff)))  # noqa: E712
    if not guest_ids:
        return 0
    workspace_ids = list(session.exec(select(Workspace.id).where(Workspace.owner_id.in_(guest_ids))))
    if workspace_ids:
        for file_id in session.exec(select(CodeFile.id).where(CodeFile.workspace_id.in_(workspace_ids))):
            store.forget(file_id)
        for model in (Message, CodeFile, WorkspaceMember):
            session.exec(delete(model).where(model.workspace_id.in_(workspace_ids)))
        session.exec(delete(Workspace).where(Workspace.id.in_(workspace_ids)))
    # Their activity in other people's workspaces.
    session.exec(delete(Message).where(Message.user_id.in_(guest_ids)))
    session.exec(delete(WorkspaceMember).where(WorkspaceMember.user_id.in_(guest_ids)))
    session.exec(update(CodeFile).where(CodeFile.created_by.in_(guest_ids)).values(created_by=None))
    session.exec(delete(User).where(User.id.in_(guest_ids)))
    session.commit()
    logger.info("Removed %d expired guest accounts", len(guest_ids))
    return len(guest_ids)
