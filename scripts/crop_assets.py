#!/usr/bin/env python3
"""
Script to crop transparent areas from PNG images.
This will find the bounding box of non-transparent pixels and crop to that area.
"""

from PIL import Image
import os

def crop_transparent(input_path, output_path=None, padding=0):
    """
    Crop transparent areas from a PNG image.
    
    Args:
        input_path: Path to input PNG file
        output_path: Path to save cropped image (defaults to overwriting input)
        padding: Optional padding to add around the cropped content
    """
    if output_path is None:
        output_path = input_path
    
    # Open the image
    img = Image.open(input_path).convert("RGBA")
    
    # Get the bounding box of non-transparent pixels
    bbox = img.getbbox()
    
    if bbox is None:
        print(f"  {input_path}: Image is fully transparent, skipping")
        return
    
    # Get original dimensions
    orig_w, orig_h = img.size
    
    # Apply padding (but stay within image bounds)
    left = max(0, bbox[0] - padding)
    top = max(0, bbox[1] - padding)
    right = min(orig_w, bbox[2] + padding)
    bottom = min(orig_h, bbox[3] + padding)
    
    # Crop the image
    cropped = img.crop((left, top, right, bottom))
    
    # Save
    cropped.save(output_path)
    
    new_w, new_h = cropped.size
    print(f"  {os.path.basename(input_path)}: {orig_w}x{orig_h} -> {new_w}x{new_h}")

def main():
    # Directory containing the assets
    assets_dir = "/Users/cayden0207/Desktop/Cursor/Eliza town/assets/ui/stardew"
    
    # Files to crop
    files_to_crop = [
        "checked.png",
        "uncheck.png",
        "tab_normal.png",
        "tab_active.png",
    ]
    
    print("Cropping transparent areas from PNG assets...")
    print()
    
    for filename in files_to_crop:
        filepath = os.path.join(assets_dir, filename)
        if os.path.exists(filepath):
            # Add small padding (2px) to preserve some breathing room
            crop_transparent(filepath, padding=2)
        else:
            print(f"  {filename}: File not found, skipping")
    
    print()
    print("Done! Assets have been cropped.")

if __name__ == "__main__":
    main()
