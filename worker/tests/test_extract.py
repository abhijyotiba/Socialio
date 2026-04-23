from pipeline.extract import parse


SIMPLE_HTML = """
<html>
<head>
  <meta property="og:title" content="OG Title" />
  <meta property="og:image" content="https://example.com/og.jpg" />
  <title>Page Title</title>
</head>
<body>
  <nav>nav content</nav>
  <article>
    <h1>Article Heading</h1>
    <p>First paragraph with some content.</p>
    <p>Second paragraph.</p>
    <img src="https://example.com/img1.jpg" />
    <img src="https://example.com/img2.jpg" />
  </article>
  <footer>footer content</footer>
</body>
</html>
"""

NO_OG_HTML = """
<html>
<head><title>Fallback Title</title></head>
<body>
  <main><p>Main content here.</p></main>
</body>
</html>
"""

RELATIVE_IMG_HTML = """
<html>
<head><title>Relative Images</title></head>
<body>
  <main>
    <img src="/assets/photo.jpg" />
    <img src="images/banner.png" />
  </main>
</body>
</html>
"""


def test_og_title_takes_precedence():
    result = parse(SIMPLE_HTML)
    assert result.title == "OG Title"


def test_title_tag_fallback():
    result = parse(NO_OG_HTML)
    assert result.title == "Fallback Title"


def test_og_image_is_first_in_media():
    result = parse(SIMPLE_HTML)
    assert result.media_urls[0] == "https://example.com/og.jpg"


def test_img_tags_included_after_og():
    result = parse(SIMPLE_HTML)
    assert "https://example.com/img1.jpg" in result.media_urls
    assert "https://example.com/img2.jpg" in result.media_urls


def test_nav_footer_stripped_from_text():
    result = parse(SIMPLE_HTML)
    assert "nav content" not in result.text
    assert "footer content" not in result.text


def test_article_text_preserved():
    result = parse(SIMPLE_HTML)
    assert "First paragraph" in result.text


def test_relative_images_resolved_with_base_url():
    result = parse(RELATIVE_IMG_HTML, base_url="https://example.com")
    assert "https://example.com/assets/photo.jpg" in result.media_urls


def test_relative_images_skipped_without_base_url():
    result = parse(RELATIVE_IMG_HTML)
    assert len(result.media_urls) == 0


def test_max_five_media_urls():
    many_imgs = "".join(
        f'<img src="https://example.com/img{i}.jpg" />' for i in range(10)
    )
    html = f"<html><body><main>{many_imgs}</main></body></html>"
    result = parse(html)
    assert len(result.media_urls) <= 5
