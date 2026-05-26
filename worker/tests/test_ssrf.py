import pytest
from unittest.mock import patch

from pipeline.scrape import _is_ssrf_safe


def _mock_gethostbyname(ip: str):
    return lambda hostname: ip


@pytest.mark.asyncio
async def test_public_ip_is_safe():
    with patch("socket.gethostbyname", return_value="93.184.216.34"):
        assert await _is_ssrf_safe("https://example.com/page") is True


@pytest.mark.asyncio
async def test_loopback_blocked():
    with patch("socket.gethostbyname", return_value="127.0.0.1"):
        assert await _is_ssrf_safe("http://localhost/") is False


@pytest.mark.asyncio
async def test_private_10_blocked():
    with patch("socket.gethostbyname", return_value="10.0.0.1"):
        assert await _is_ssrf_safe("http://internal.corp/") is False


@pytest.mark.asyncio
async def test_private_192_168_blocked():
    with patch("socket.gethostbyname", return_value="192.168.1.1"):
        assert await _is_ssrf_safe("http://192.168.1.1/") is False


@pytest.mark.asyncio
async def test_link_local_aws_metadata_blocked():
    with patch("socket.gethostbyname", return_value="169.254.169.254"):
        assert await _is_ssrf_safe("http://169.254.169.254/latest/meta-data/") is False


@pytest.mark.asyncio
async def test_private_172_16_blocked():
    with patch("socket.gethostbyname", return_value="172.16.0.1"):
        assert await _is_ssrf_safe("http://172.16.0.1/") is False


@pytest.mark.asyncio
async def test_dns_failure_returns_false():
    import socket
    with patch("socket.gethostbyname", side_effect=socket.gaierror("nxdomain")):
        assert await _is_ssrf_safe("http://does-not-exist.invalid/") is False


@pytest.mark.asyncio
async def test_missing_hostname_returns_false():
    assert await _is_ssrf_safe("not-a-url") is False
