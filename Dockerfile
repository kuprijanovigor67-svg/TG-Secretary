FROM python:3.11-slim

RUN apt-get update && apt-get install -y \
    curl \
    gnupg \
    ffmpeg \
    python-is-python3 \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

RUN apt-get install -y rustc cargo \
    && pip install --no-cache-dir setuptools-rust openai-whisper

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

RUN python -c "import whisper; whisper.load_model('tiny')"

CMD ["node", "index.js"]
