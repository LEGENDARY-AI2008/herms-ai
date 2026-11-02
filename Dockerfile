FROM nousresearch/hermes-agent:latest

USER root
WORKDIR /app
COPY start.sh /app/start.sh
COPY SOUL.md /app/SOUL.md
COPY pair.mjs /app/pair.mjs
COPY pair_server.py /app/pair_server.py
RUN sed -i 's/\r$//' /app/start.sh && chmod +x /app/start.sh

ENV HERMES_HOME=/opt/data
ENTRYPOINT ["/bin/bash", "/app/start.sh"]
