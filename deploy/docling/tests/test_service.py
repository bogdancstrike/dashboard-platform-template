import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from nucleus_docling.convert import converter_for
from nucleus_docling.server import app
from nucleus_docling.validation import UnsafeDocument, validate


class ConversionSecurity(unittest.TestCase):
    def test_all_formats_use_cpu_and_disable_document_fetching(self):
        import torch

        converter = converter_for({})
        self.assertEqual(len(converter.allowed_formats), 37)
        self.assertIsNone(torch.version.cuda)
        self.assertFalse(torch.cuda.is_available())
        for option in converter.format_to_options.values():
            self.assertEqual(option.pipeline_options.accelerator_options.device, "cpu")
            self.assertFalse(option.pipeline_options.enable_remote_services)
            self.assertFalse(option.pipeline_options.allow_external_plugins)
            if option.backend_options:
                self.assertFalse(option.backend_options.enable_local_fetch)
                self.assertFalse(option.backend_options.enable_remote_fetch)

    def test_xml_entities_are_blocked_in_unicode_encodings(self):
        for encoding in ("utf-8", "utf-16", "utf-32"):
            with self.subTest(encoding=encoding), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "source.xml"
                path.write_bytes('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>'.encode(encoding))
                with self.assertRaises(UnsafeDocument) as error:
                    validate(path)
                self.assertEqual(error.exception.code, "FILE_EXTERNAL_REFERENCE")

    def test_archive_traversal_and_bombs_are_blocked(self):
        for name, content, code in [("../../outside", b"payload", "FILE_UNSAFE_ARCHIVE"), ("content.xml", b"0" * 100_000, "FILE_LIMIT_EXCEEDED")]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "book.epub"
                with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                    archive.writestr(name, content)
                with self.assertRaises(UnsafeDocument) as error:
                    validate(path)
                self.assertEqual(error.exception.code, code)

    def test_upload_is_bytes_only_and_options_cannot_request_paths_or_urls(self):
        with TestClient(app) as client:
            response = client.post("/convert", files={"file": ("page.html", b"<p>Evidence</p>")}, data={"options": json.dumps({"url": "http://outside"})})
            self.assertEqual(response.status_code, 422)
            self.assertEqual(client.post("/convert", files={"file": ("run.exe", b"MZ")}).status_code, 415)
            with patch("nucleus_docling.server.run_job", return_value={"ok": True, "device": "cpu"}) as job:
                response = client.post("/convert", files={"file": ("../../page.html", b"<p>Evidence</p>")})
                self.assertEqual(response.json(), {"ok": True, "device": "cpu"})
                self.assertTrue(str(job.call_args.args[0]).startswith("/tmp/convert-"))
            response = client.post("/convert", content=b"x", headers={"Content-Length": str(60 * 1024 * 1024)})
            self.assertEqual(response.status_code, 413)


if __name__ == "__main__":
    unittest.main()


class TemplatesAndXmlTest(unittest.TestCase):
    def _package(self, directory, name, entries):
        path = Path(directory) / name
        with zipfile.ZipFile(path, "w") as archive:
            for entry, data in entries:
                archive.writestr(entry, data)
        return path

    def test_office_templates_convert_as_documents(self):
        from nucleus_docling.templates import as_document

        with tempfile.TemporaryDirectory() as directory:
            ooxml = self._package(directory, "input.dotx", [("[Content_Types].xml", b'<Override ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml"/>'),
                                                          ("word/document.xml", b"<w:document/>")])
            document = as_document(ooxml)
            self.assertEqual(document.suffix, ".docx")
            with zipfile.ZipFile(document) as archive:
                self.assertIn(b"wordprocessingml.document.main+xml", archive.read("[Content_Types].xml"))
                self.assertEqual(archive.read("word/document.xml"), b"<w:document/>")
            odf = self._package(directory, "input.otp", [("mimetype", b"application/vnd.oasis.opendocument.presentation-template"),
                                                       ("META-INF/manifest.xml", b'media-type="application/vnd.oasis.opendocument.presentation-template"')])
            document = as_document(odf)
            with zipfile.ZipFile(document) as archive:
                self.assertEqual(archive.infolist()[0].filename, "mimetype")
                self.assertEqual(archive.infolist()[0].compress_type, zipfile.ZIP_STORED)
                self.assertEqual(archive.read("mimetype"), b"application/vnd.oasis.opendocument.presentation")
            plain = self._package(directory, "input.docx", [("[Content_Types].xml", b"wordprocessingml.document.main+xml")])
            self.assertEqual(as_document(plain), plain)
            text = Path(directory) / "input.txt"
            text.write_text("x")
            self.assertEqual(as_document(text), text)

    def test_doctype_naming_a_dtd_is_allowed_but_inline_dtds_are_not(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "article.nxml"
            path.write_bytes(b'<!DOCTYPE article PUBLIC "-//NLM//DTD JATS (Z39.96) Journal Archiving v1.2//EN" "JATS-archivearticle1.dtd"><article/>')
            validate(path)
            path.write_bytes(b'<!DOCTYPE article [<!ELEMENT article ANY>]><article/>')
            with self.assertRaises(UnsafeDocument):
                validate(path)

    def test_conversions_that_need_fetching_get_an_actionable_message(self):
        from docling.exceptions import ConversionError, OperationNotAllowed

        from nucleus_docling.convert import failure

        try:
            try:
                raise OperationNotAllowed("fetch taxonomy")
            except OperationNotAllowed as inner:
                raise ConversionError("Could not initialize XBRL backend") from inner
        except ConversionError as error:
            result = failure(error)
        self.assertEqual(result["code"], "FILE_EXTERNAL_REFERENCE")
        self.assertNotIn("taxonomy\"", result["detail"])
        self.assertEqual(failure(ValueError("secret parser text"))["code"], "FILE_PARSE_ERROR")
        self.assertNotIn("secret", failure(ValueError("secret parser text"))["detail"])


class MediaTypesTest(unittest.TestCase):
    def test_docling_media_types_are_registered_for_origin_validation(self):
        import mimetypes

        import nucleus_docling.convert as convert

        for ext, media in convert.MEDIA_TYPES.items():
            self.assertIn(media, mimetypes.types_map.values(), ext)


class LimitsTest(unittest.TestCase):
    def test_media_gets_a_longer_configurable_limit(self):
        from nucleus_docling import limits

        with patch.dict("os.environ", {}, clear=True):
            self.assertEqual((limits.job_timeout(".pdf"), limits.job_timeout(".WAV"), limits.concurrency()), (300, 900, 2))
        with patch.dict("os.environ", {"DOCLING_MEDIA_TIMEOUT_S": "1800", "DOCLING_DOCUMENT_TIMEOUT_S": "5", "DOCLING_CONCURRENCY": "x"}):
            self.assertEqual((limits.job_timeout(".mp4"), limits.job_timeout(".docx"), limits.concurrency()), (1800, 30, 2))
