"""Pure-PyTorch drop-in for the `fused_ssim` CUDA package used by gsplat's simple_trainer.

Same signature and maths as rahul-goel/fused-ssim (11x11 Gaussian window, sigma 1.5,
C1 = 0.01^2, C2 = 0.03^2, "valid" crops a 5 px border), but needs no compilation.
Slower than the fused kernel, which is irrelevant for a handful of small training images.
"""
import torch
import torch.nn.functional as F

__all__ = ["fused_ssim"]
allowed_padding = ["same", "valid"]
_WIN, _SIGMA = 11, 1.5


def _window(channels: int, device, dtype) -> torch.Tensor:
    x = torch.arange(_WIN, device=device, dtype=dtype) - _WIN // 2
    g = torch.exp(-(x ** 2) / (2 * _SIGMA ** 2))
    g = g / g.sum()
    w = (g[:, None] * g[None, :])[None, None]
    return w.expand(channels, 1, _WIN, _WIN).contiguous()


def fused_ssim(img1: torch.Tensor, img2: torch.Tensor, padding: str = "same", train: bool = True) -> torch.Tensor:
    assert padding in allowed_padding
    c1, c2 = 0.01 ** 2, 0.03 ** 2
    ch = img1.shape[1]
    w = _window(ch, img1.device, img1.dtype)
    blur = lambda t: F.conv2d(t, w, padding=_WIN // 2, groups=ch)
    mu1, mu2 = blur(img1), blur(img2)
    mu1_sq, mu2_sq, mu12 = mu1 * mu1, mu2 * mu2, mu1 * mu2
    s1 = blur(img1 * img1) - mu1_sq
    s2 = blur(img2 * img2) - mu2_sq
    s12 = blur(img1 * img2) - mu12
    ssim_map = ((2 * mu12 + c1) * (2 * s12 + c2)) / ((mu1_sq + mu2_sq + c1) * (s1 + s2 + c2))
    if padding == "valid":
        ssim_map = ssim_map[:, :, 5:-5, 5:-5]
    return ssim_map.mean()
