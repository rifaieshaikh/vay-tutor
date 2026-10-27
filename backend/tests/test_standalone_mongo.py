import asyncio

from motor.motor_asyncio import AsyncIOMotorClient

from app.config import Settings
from app.db import _patch_standalone_transactions, _StandaloneTransaction, configure_mongo


def test_standalone_local_mongo_skips_replica_set_transactions():
    _patch_standalone_transactions()
    from pymongo.synchronous.client_session import ClientSession

    class FakeSession:
        def __init__(self):
            self._client = type("Client", (), {"_vay_standalone": True})()

    context = ClientSession.start_transaction(FakeSession())
    assert isinstance(context, _StandaloneTransaction)
    assert context.__enter__() is context


def test_local_mongo_url_without_replica_set_marks_the_client_standalone():
    async def run():
        settings = Settings(
            mongo_url="mongodb://127.0.0.1:27017/?directConnection=true",
            db_name="vay_tutor",
            data_dir=__import__("pathlib").Path("."),
            deployment_mode="local",
            cookie_secure=False,
            worker_enabled=False,
        )
        client = AsyncIOMotorClient(settings.mongo_url)
        try:
            await configure_mongo(client, settings)
            assert getattr(client.delegate, "_vay_standalone", False) is True
            async with await client.start_session() as session:
                async with session.start_transaction():
                    assert session.in_transaction is False
        finally:
            client.close()

    asyncio.run(run())
