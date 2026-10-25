"""Logs estruturados (structlog). Os logs do discord.py e do livekit passam pelo
mesmo formatter, então tudo sai como JSON (ou legível, com LOG_FORMAT=console)."""
import logging

import structlog


def setup_logging(level: str = 'INFO', fmt: str = 'json') -> None:
    shared = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt='iso', utc=True),
        structlog.processors.format_exc_info,
    ]
    structlog.configure(
        processors=shared + [structlog.stdlib.ProcessorFormatter.wrap_for_formatter],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )
    renderer = structlog.processors.JSONRenderer() if fmt == 'json' else structlog.dev.ConsoleRenderer()
    handler = logging.StreamHandler()
    handler.setFormatter(structlog.stdlib.ProcessorFormatter(
        foreign_pre_chain=shared,
        processors=[structlog.stdlib.ProcessorFormatter.remove_processors_meta, renderer],
    ))
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)
    # o receptor de voz loga cada pacote de ssrc desconhecido em INFO
    logging.getLogger('discord.ext.voice_recv').setLevel(max(logging.WARNING, root.level))
