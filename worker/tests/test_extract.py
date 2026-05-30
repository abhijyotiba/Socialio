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


def test_skips_dummy_recaptcha_title():
    html_with_recaptcha = """
    <html>
    <head>
      <meta property="og:title" content="reCAPTCHA" />
      <title>Cloudflare security check</title>
    </head>
    <body>
      <h1>Quantum Computing: The Next Big Thing</h1>
    </body>
    </html>
    """
    result = parse(html_with_recaptcha)
    assert result.title == "Quantum Computing: The Next Big Thing"


def test_filters_junk_images():
    html_with_junk = """
    <html>
    <head><title>Test Images</title></head>
    <body>
      <main>
        <!-- Keep: high quality main image -->
        <img src="https://example.com/resize:fit:700/main.png" />
        
        <!-- Skip: small size width attribute -->
        <img src="https://example.com/real.jpg" width="32" height="32" />
        
        <!-- Skip: size pattern in URL -->
        <img src="https://example.com/resize:fill:32:32/avatar.png" />
        
        <!-- Skip: keyword in class/id/alt -->
        <img src="https://example.com/profile.png" alt="user avatar" />
        <img src="https://example.com/logo-mark.png" class="footer-logo" />
      </main>
    </body>
    </html>
    """
    result = parse(html_with_junk)
    assert len(result.media_urls) == 1
    assert result.media_urls[0] == "https://example.com/resize:fit:700/main.png"
