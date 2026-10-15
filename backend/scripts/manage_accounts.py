"""Create an administrator or recover a password from the server console.

python -m scripts.manage_accounts create-admin LOGIN --name "Display name"
python -m scripts.manage_accounts reset-password LOGIN
Passwords are read with getpass, never from arguments or environment variables.
"""

import argparse
import getpass

from sqlalchemy import select

from app.config import Settings
from app.infrastructure.postgres.access import Accounts
from app.infrastructure.postgres.database import create_database_engine, create_session_factory
from app.infrastructure.postgres.models import AccountRow


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("create-admin", "reset-password"))
    parser.add_argument("login")
    parser.add_argument("--name")
    args = parser.parse_args()
    password = getpass.getpass("Passphrase (15–256 characters): ")
    if password != getpass.getpass("Repeat passphrase: "):
        parser.error("Passphrases do not match")
    engine = create_database_engine(Settings())
    factory = create_session_factory(engine)
    service = Accounts(factory)
    try:
        if args.action == "create-admin":
            service.create(args.login, args.name or args.login, password, admin=True)
        else:
            from app.application.access import username

            with factory.begin() as session:
                target = session.scalar(
                    select(AccountRow.id).where(AccountRow.username == username(args.login))
                )
            if target is None:
                parser.error("Account not found")
            service.change(target, actor_id=None, password=password)
        print("Account updated. Existing sessions for a changed password have been revoked.")
    except ValueError:
        parser.error(
            "Account operation refused; check login, passphrase length and existing account"
        )
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
