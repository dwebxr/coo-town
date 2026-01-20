// Standalone test script for Gemini 3 Pro Image Generation (ESM)
const apiKey = process.env.GOOGLE_API_KEY || "AIzaSyB4G6gNfYqTE7D8gNQQrGMf7sHWhnLi5vM";

async function testGen() {
    const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent`;
    
    const spritePrompt = `Generate a pixel art sprite sheet of A small blue robot.
    Structure: Strict 3 columns x 4 rows grid.
    Columns: 3 animation frames.
    Rows: 4 directions (Front, Left, Right, Back).
    Style: Stardew Valley compatible RPG pixel art.
    Background: Transparent or White.
    Output: ONLY the sprite sheet image.`;

    console.log("Testing Gemini 3 Pro (Nano Banana)...");

    try {
        const response = await fetch(GEMINI_ENDPOINT, {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                "x-goog-api-key": apiKey
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: spritePrompt }]
                }],
                generationConfig: {
                    responseModalities: ["IMAGE"],
                    imageConfig: {
                        aspectRatio: "3:4",
                        imageSize: "1K"
                    }
                }
            })
        });

        if (!response.ok) {
            console.error("Status:", response.status, response.statusText);
            console.error("Text:", await response.text());
            return;
        }

        const data = await response.json();
        console.log("Response candidates:", data.candidates ? data.candidates.length : 0);
        
        if (data.candidates && data.candidates.length > 0) {
            const parts = data.candidates[0].content?.parts || [];
            console.log("Parts found:", parts.length);
            
            const imagePart = parts.find(p => p.inline_data);
            if (imagePart) {
                console.log("SUCCESS! Inline image data found.");
                console.log("Data size:", imagePart.inline_data.data.length, "bytes (encoded)");
            } else {
                console.log("FAILURE: No inline image data.");
                console.log("Full Response:", JSON.stringify(data, null, 2));
            }
        } else {
            console.log("No candidates.");
            console.log("Full Response:", JSON.stringify(data, null, 2));
        }

    } catch (e) {
        console.error("Exception:", e);
    }
}

testGen();
