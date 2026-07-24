# Image générique pour instance Hermes Agent (copie locale pour build context)
FROM node:20-alpine AS base

RUN apk add --no-cache bash curl git python3 py3-pip

RUN curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash

RUN addgroup -S agent && adduser -S agent -G agent
USER agent
WORKDIR /home/agent

ENV HERMES_HOME=/home/agent/.hermes
ENV PATH="/home/agent/.hermes/bin:${PATH}"

COPY --chown=agent:agent hermes.config.json /home/agent/hermes.config.json
COPY --chown=agent:agent skills/ /home/agent/workspace/skills/

ENTRYPOINT ["hermes"]
CMD ["run", "--config", "/home/agent/hermes.config.json", "--headless", "--approval-mode", "on-risk"]
