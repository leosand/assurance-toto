FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir fastapi uvicorn
COPY app.py .
EXPOSE 8090
CMD ["python", "app.py"]
