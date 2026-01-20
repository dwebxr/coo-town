import { v } from 'convex/values';
import { action } from './_generated/server';
import { api } from './_generated/api';
import Replicate from 'replicate';

export const generate = action({
  args: {
    prompt: v.string(),
    image: v.optional(v.string()), // Base64 string of the reference image
  },
  handler: async (ctx, args) => {
    // 1. Validate Credentials
    // User referred to Gemini/Imagen as "nanobanana", so we check both for flexibility.
    const googleApiKey = process.env.GOOGLE_API_KEY || process.env.NANOBANANA_API_KEY; 
    const replicateToken = process.env.REPLICATE_API_TOKEN;

    if (!googleApiKey || !replicateToken) {
      throw new Error("Missing API Keys: Please set GOOGLE_API_KEY (or NANOBANANA_API_KEY) and REPLICATE_API_TOKEN.");
    }

    let finalPrompt = args.prompt;

    // --- Step 0: Describe Image (if provided) ---
    if (args.image) {
        console.log("Analyzing uploaded reference image...");
        try {
            // Remove header if present (e.g. "data:image/png;base64,")
            const base64Image = args.image.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, "");
            
            const visionResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${googleApiKey}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { text: "Describe this character's appearance in detail for a sprite sheet generation prompt. Focus on clothing, colors, hair, and key features. Keep it concise." },
                            { inline_data: { mime_type: "image/png", data: base64Image } } // Assuming PNG/JPEG, API is flexible usually.
                        ]
                    }]
                })
            });
            
            if (!visionResponse.ok) {
                 console.warn(`Vision API warning: ${await visionResponse.text()}`);
            } else {
                const visionData = await visionResponse.json();
                const description = visionData.candidates?.[0]?.content?.parts?.[0]?.text;
                if (description) {
                    console.log("Refined prompt with image description:", description);
                    finalPrompt = `${args.prompt || "A character"} inspired by: ${description}`;
                }
            }
        } catch (e) {
            console.error("Failed to analyze image, reusing original prompt", e);
        }
    }

    console.log(`Step 1: Generating Sprite Sheet with prompt: ${finalPrompt}`);

    // --- Step 1: Generate Sprite Sheet (Nano Banana Pro / gemini-3-pro-image-preview) ---
    // User requested "nanobanana pro (gemini-3-pro-image-preview)" via generateContent
    // Using configuration from: https://ai.google.dev/gemini-api/docs/image-generation#rest
    // Verified working via curl with: responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "3:4", imageSize: "1K" }
    
    const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${googleApiKey}`;
    
    // Construct the payload parts
    const parts: any[] = [
        { text: `Design a pixel art sprite sheet based on the uploaded reference image.
        Context: ${finalPrompt}.
        Instructions:
        1. Extract character features from the reference image.
        2. Strictly follow the classic RPG walking sprite layout of Stardew Valley.
        3. Generate continuous action frames for Front, Back, Left, and Right views.
        4. Ensure all directions are correct and distinct (Left vs Right).
        5. Maintain balanced character proportions.
        6. Keep the image sharp and clear, meeting professional game art standards.
        7. Layout: Strict 4 rows (Front, Left, Right, Back) x 3 columns (Stand, Walk, Walk).
        8. Output: ONLY the sprite sheet image.` }
    ];

    // If a reference image is provided, add it to the generation request (Multimodal)
    if (args.image) {
        // Ensure clean base64
        const base64Image = args.image.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, "");
        parts.push({
            inlineData: {
                mimeType: "image/png", // defaulting to png, or we could detect
                data: base64Image
            }
        });
        console.log("Adding reference image to Gemini 3 Pro input...");
    }

    console.log(`Step 1: Generating with gemini-3-pro-image-preview (Strict Image Mode, Query Auth, Multimodal)...`);
    
    const geminiResponse = await fetch(GEMINI_ENDPOINT, {
        method: "POST",
        headers: { 
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: {
                responseModalities: ["IMAGE"], // Strict image output
                imageConfig: {
                    aspectRatio: "3:4",
                    imageSize: "1K"
                }
            }
        })
    });

    if (!geminiResponse.ok) {
        const errorText = await geminiResponse.text();
        console.warn(`Gemini 3 Pro Generation failed (${geminiResponse.status}): ${errorText}`);
        throw new Error(`Gemini 3 Pro Generation Failed: ${errorText}`);
    }

    const geminiData = await geminiResponse.json();
    console.log("Gemini 3 Pro Response received.");
    
    // Parse response for inline image data
    let generatedBase64 = null;
    
    // Check for inline image data in candidates
    if (geminiData.candidates?.[0]?.content?.parts) {
        for (const part of geminiData.candidates[0].content.parts) {
             // API returns camelCase 'inlineData' in raw JSON fetch response
             if (part.inlineData && part.inlineData.data) {
                generatedBase64 = part.inlineData.data;
                console.log("Found image data in 'inlineData'");
                break;
            }
            // Fallback for snake_case if API behavior changes
            if (part.inline_data && part.inline_data.data) {
                generatedBase64 = part.inline_data.data;
                console.log("Found image data in 'inline_data'");
                break;
            }
        }
    }
    
    if (!generatedBase64) {
        console.log("Full Gemini Response:", JSON.stringify(geminiData, null, 2));
        throw new Error("Gemini 3 Pro returned successfully but contained no inline image data.");
    }
    
    const generatedImageUri = `data:image/png;base64,${generatedBase64}`;

    
    // --- Step 2: Remove Background (Replicate: 851-labs/background-remover) ---
    console.log("Step 2: Removing background via Replicate...");
    const replicate = new Replicate({ auth: replicateToken });
    
    const output = await replicate.run("851-labs/background-remover:a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc" as any, {
      input: {
        image: generatedImageUri,
        format: "png",
        background_type: "rgba" // Transparent
      }
    });

    // Output is usually a string URL
    const cleanImageUrl = String(output);
    console.log("Step 2 Success:", cleanImageUrl);


    // --- Step 3: Save to Convex Storage ---
    console.log("Step 3: Saving to storage...");
    const cleanImageResponse = await fetch(cleanImageUrl);
    const cleanImageBlob = await cleanImageResponse.blob();

    // 1. Generate Upload URL
    const uploadUrl = await ctx.runMutation(api.characterSprites.generateUploadUrl);
    
    // 2. Upload
    const uploadResult = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": cleanImageBlob.type },
      body: cleanImageBlob,
    });

    if (!uploadResult.ok) {
      throw new Error(`Failed to upload to Convex storage: ${await uploadResult.text()}`);
    }
    
    const { storageId } = await uploadResult.json();
    
    // Return the storageId
    return { storageId };
  },
});
