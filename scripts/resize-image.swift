// Crops a photo to 4:5 and resizes it to 1440x1800 JPEG for site/images/ (macOS only).
// Applies the EXIF orientation, so the output is upright with no rotation tag.
// Usage: swift scripts/resize-image.swift <in> <out> [crop-top-px] [quality]
//   crop-top-px  rows to trim from the top of the upright photo (default: center crop)
//   quality      JPEG quality 0..1 (default 0.5, ≈200-250 KB)
import Foundation
import ImageIO
import CoreGraphics
import UniformTypeIdentifiers

let a = CommandLine.arguments
guard a.count >= 3 else {
  FileHandle.standardError.write("usage: swift scripts/resize-image.swift <in> <out> [crop-top-px] [quality]\n".data(using: .utf8)!)
  exit(1)
}
guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: a[1]) as CFURL, nil) else {
  FileHandle.standardError.write("cannot read \(a[1])\n".data(using: .utf8)!)
  exit(1)
}
let decode: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true,
  kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: 100_000]
let img = CGImageSourceCreateThumbnailAtIndex(src, 0, decode as CFDictionary)!

let W = 1440, H = 1800
let w = Double(img.width), h = Double(img.height)
let cropH = min(h, w * Double(H) / Double(W))
let cropW = cropH * Double(W) / Double(H)
let top = a.count > 3 ? Double(a[3])! : (h - cropH) / 2
let crop = img.cropping(to: CGRect(x: (w - cropW) / 2, y: min(top, h - cropH), width: cropW, height: cropH))!

let ctx = CGContext(data: nil, width: W, height: H, bitsPerComponent: 8, bytesPerRow: 0,
  space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
ctx.interpolationQuality = .high
ctx.draw(crop, in: CGRect(x: 0, y: 0, width: W, height: H))

let quality = a.count > 4 ? Double(a[4])! : 0.5
let dst = CGImageDestinationCreateWithURL(URL(fileURLWithPath: a[2]) as CFURL, UTType.jpeg.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(dst, ctx.makeImage()!, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
guard CGImageDestinationFinalize(dst) else { exit(1) }
print("\(a[2]): \(W)x\(H)")
