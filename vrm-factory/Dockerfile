FROM python:3.10-slim

# 1. Install System Dependencies (GL libraries for Blender & OpenCV)
RUN apt-get update && apt-get install -y \
    curl xz-utils libxi6 libxrender1 libgl1-mesa-glx libxxf86vm1 libxfixes3 \
    libsm6 libxext6 \
    && rm -rf /var/lib/apt/lists/*

# 2. Install Blender 3.6 LTS
WORKDIR /opt/blender
RUN curl -SL https://download.blender.org/release/Blender3.6/blender-3.6.5-linux-x64.tar.xz \
    | tar -xJ --strip-components=1
ENV PATH="/opt/blender:${PATH}"

# 3. Project Setup
WORKDIR /app
COPY . /app

# 4. Install Python Libs
RUN pip install --no-cache-dir -r requirements.txt

# 5. Install VRM Addon into Blender
RUN blender --background --python scripts/install_deps.py || true

# 6. Start Server
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
