# Semantica spike image — a SEPARATE service, deliberately not in the backend.
#
# WHY A SEPARATE IMAGE (measured, not stylistic)
# Semantica's core dependency list is ~155 packages and includes torch, transformers,
# sentence-transformers, spacy, opencv-python, librosa, gensim, faiss-cpu, umap-learn,
# matplotlib, seaborn, plotly and ipywidgets. Installing it into backend/ would also add a
# hard `httpx<0.29.0` cap on a dependency the app's MCP client shares, so the whole backend
# could never move past it. The estate's own pattern is the right one here: a dedicated
# Deployment + Service, like rancher-mcp / proxmox-mcp / rerank-svc.
#
# CPU-ONLY TORCH, ON PURPOSE
# A plain `pip install semantica` pulls the CUDA build of torch (~2-3 GB of wheel for a
# cluster with no GPUs). Installing the CPU wheel from PyTorch's own index first means pip
# sees torch already satisfied. The backend image carries the CUDA build as dead weight —
# no reason to repeat that here.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# libgl1/libglib2.0 are opencv's runtime needs (a core dependency of semantica);
# without them `import cv2` fails at import time with a bare ImportError.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential curl libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# CPU torch first, so semantica's torch>=1.13.1 is already satisfied.
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch

RUN pip install semantica psycopg2-binary httpx

# The spaCy model for Semantica's `ml` extractor.
#
# NOT OPTIONAL IF YOU WANT TO EVALUATE EXTRACTION QUALITY. Without it, method="ml" fails to
# load the model ONCE PER ARTICLE, silently falls back to the regex extractor every time, and
# still reports itself as "ml" in the log — which turned a seconds-long run into 29 minutes
# and made the results look like Semantica's when they were the fallback's.
# `spacy download` picks the model build matching the installed spaCy version.
RUN python -m spacy download en_core_web_sm

# Probe the library the way the spike will use it, at BUILD time: if this import fails the
# image never ships, rather than failing later inside a pod. The spaCy load is probed too —
# a model that cannot load is exactly the failure this image exists to avoid.
RUN python -c "import semantica, sys; print('semantica ok', getattr(semantica, '__version__', '?')); print('py', sys.version.split()[0])" \
 && python -c "import spacy; nlp = spacy.load('en_core_web_sm'); d = nlp('Kubernetes runs on Ubuntu at 10.10.10.115 in 2026'); print('spacy ok', spacy.__version__, [(e.text, e.label_) for e in d.ents])"

WORKDIR /app
COPY spike_pipeline.py /app/spike_pipeline.py

EXPOSE 8000

CMD ["python", "/app/spike_pipeline.py"]