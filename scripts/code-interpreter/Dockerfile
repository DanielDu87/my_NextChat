# syntax=docker/dockerfile:1.7
# Keep this file in sync with the deployment directory's upstream Dockerfile.
ARG PYTHON_IMAGE=python:3.10-slim
FROM ${PYTHON_IMAGE} AS builder

WORKDIR /app

ARG APT_MIRROR=https://mirrors.aliyun.com
ARG PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/

COPY requirements.txt requirements.nextchat.txt ./

RUN --mount=type=cache,id=nextchat-code-interpreter-pip,target=/root/.cache/pip \
    set -eux; \
    sed -i \
      -e "s|http://deb.debian.org/debian-security|${APT_MIRROR}/debian-security|g" \
      -e "s|http://deb.debian.org/debian|${APT_MIRROR}/debian|g" \
      /etc/apt/sources.list.d/debian.sources; \
    apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libssl-dev \
    libffi-dev \
    libpq-dev \
    python3-dev \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --index-url "$PIP_INDEX_URL" "pip<24" "setuptools<69" "wheel<0.42" "Cython<3" \
    && pip install --no-build-isolation --index-url "$PIP_INDEX_URL" -r requirements.txt -r requirements.nextchat.txt

FROM ${PYTHON_IMAGE}

WORKDIR /app

COPY --from=builder /usr/local/lib/python3.10/site-packages /usr/local/lib/python3.10/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY . .

RUN mkdir -p /mnt/data

ENV PYTHONUNBUFFERED=1

EXPOSE 5000

CMD ["gunicorn", "--timeout", "120", "-b", "0.0.0.0:5000", "nextchat_runtime:app"]
