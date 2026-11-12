"""Build-time downloads only; runtime containers have no external network."""
from pathlib import Path

from docling.utils.model_downloader import download_models

if __name__ == "__main__":
    download_models(output_dir=Path("/models"), with_layout=True, with_tableformer=True,
                    with_code_formula=False, with_picture_classifier=False, with_rapidocr=False,
                    whisper_models=["tiny"])
