FROM nousresearch/hermes-agent:latest

USER root
WORKDIR /app
COPY start.sh SOUL.md pair.mjs pair_server.py /app/
RUN sed -i 's/\r$//' /app/start.sh && chmod +x /app/start.sh

ENV HERMES_HOME=/opt/data
CMD ["/bin/bash", "/app/start.sh"]