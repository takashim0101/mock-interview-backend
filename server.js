// backend/server.js
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Load environment variables from .env file
dotenv.config();

const app = express();
const port = process.env.PORT || 3001; // Use port from .env or default to 3001

// Middleware to enable CORS and parse JSON request bodies
app.use(cors());
app.use(express.json());

// Initialize Google Generative AI with API Key
const API_KEY = process.env.GOOGLE_API_KEY;
if (!API_KEY) {
    console.error('GOOGLE_API_KEY is not set in .env file.');
    console.error('Please obtain your API key from https://ai.google.dev/gemini-api/docs/get-started/nodejs and add it to your .env file.');
    process.exit(1); // Exit if API key is not configured
}
const genAI = new GoogleGenerativeAI(API_KEY);

// In-memory storage for chat histories. In a production environment,
// this would be replaced with a persistent database (e.g., Firestore).
const chatHistories = new Map();

// Detailed descriptions of insurance products based on provided information.
// These descriptions will be embedded directly into the AI's system instruction
// to give Tina comprehensive knowledge.
const insuranceProducts = {
    MBI: {
        name: "Mechanical Breakdown Insurance (MBI)",
        description: `MBI covers the costs of repairing your car that arises from unexpected mechanical or electrical breakdowns after the manufacturer's warranty expires. It is NOT car insurance; it does not cover accidents, fire, theft, or cosmetic damage.
        Key points for MBI:
        - Covers major components like engine, transmission, fuel system, turbo unit, electrical, cooling systems, and steering.
        - Policies can be expensive, typically costing around $1,000 to over $4,000 for 1-4 years, and are often added to car loans (meaning you pay interest on it).
        - Significant exclusions apply: pre-existing conditions, manufacturer recalls, chassis/panel/paintwork/glass, batteries, exhaust systems, catalytic converters, tyres, light bulbs, fuel tanks, keys, cambelt failure, servicing/maintenance, rust/contamination, wrong fuel/oil use, and unapproved repairs. Many "breakdowns" are ineligible.
        - Value varies greatly: potentially invaluable for high-end European cars (due to high repair costs), but less so for highly reliable everyday cars (e.g., Toyota, Honda) where likelihood of frequent or catastrophic failures is lower.
        - Consumer NZ and Australian findings suggest MBI can offer poor value, with a significant portion of the premium going to dealer commissions rather than claims.
        - Not compulsory; you can buy it separately from a car loan.
        - Alternatives include self-insuring (setting aside money for repairs) or getting a pre-purchase inspection and regular servicing.
        - When considering MBI, assess your vehicle's age, mileage, repair history, and intended use. Always read the fine print and compare options carefully.`,
        link: "https://www.moneyhub.co.nz/mechanical-breakdown-insurance.html"
    },
    Comprehensive: {
        name: "Comprehensive Car Insurance",
        description: `Comprehensive car insurance offers the broadest protection. It covers damage to *your own vehicle* (e.g., from accidents, fire, theft, natural disasters) regardless of fault, and also covers damage your vehicle causes to *other people's vehicles or property* (Third Party Liability).
        Key benefits often include: cover for hit-and-run incidents, new vehicle replacement, towing, and rental car options (check specific terms).
        Cost factors: Price varies significantly based on driver's age, gender, accident history, location (e.g., Auckland is 20-35% higher than Dunedin/Hamilton), car model/year, storage location (garage vs street), annual distance driven, and private vs business use.
        Comparison: Our research shows significant price variations, with Cove often being the cheapest and Tower offering very comprehensive policies.
        Important considerations:
        - Always compare quotes and avoid auto-renewing.
        - Consider 'Agreed Value' vs 'Market Value': 'Agreed Value' provides a fixed payout (good for cars holding value), while 'Market Value' pays out based on current market worth (which depreciates). Be aware of depreciation clauses.
        - Paying annually can save 10-15% compared to monthly.
        - Be aware of common exclusions and hidden clauses: depreciation clauses on agreed value, 'betterment charges' (paying for upgraded parts), named driver restrictions, no cover for unsealed roads/private property, unauthorised repairs, and rental car coverage traps.
        - Always disclose accurate information to your insurer to avoid claim denials.
        - You can reduce premiums by increasing excess, paying annually, bundling policies, installing security devices (for high-risk cars like Toyota Aqua, Mazda Demio), and maintaining a no-claims record.`,
        link: "https://www.moneyhub.co.nz/car-insurance.html"
    },
    ThirdParty: {
        name: "Third Party Car Insurance",
        description: `Third Party car insurance is the most basic and often legally required type of car insurance. It *only covers* the cost of damage your vehicle causes to *other people's property* (e.g., their car, fence, or building). It does NOT cover any damage to your own vehicle if you are at fault.
        There are two main types:
        1. **Standard Third Party:** Protects you from legal liability for damage you cause to other people's vehicles and property. It does NOT cover your own car for any damage, theft, or fire.
        2. **Third Party Fire and Theft:** Adds coverage for your own car if it is stolen or damaged/destroyed by fire (unrelated to an accident you caused). It still does NOT cover accidental damage to your own car if you are at fault.
        Key points for Third Party policies:
        - Generally suitable for low-value vehicles (e.g., under $5,000 market value) where you can afford to repair or replace your own car.
        - Some policies (e.g., Tower, AA Insurance, AMP, AMI, State, Protecta) may cover damage to your car if an uninsured third party is at fault and you can identify them (up to a certain limit, typically $3,000-$5,000).
        - Exclusions typically include: accidental damage to your own car if you're at fault, storm/water/hail damage to your car, and items stolen *from* your car (these are usually covered by Comprehensive).
        - Costs typically start around $200 a year (for drivers over 25 with no accident history). Third Party Fire and Theft is more expensive than standard Third Party, but still significantly cheaper than Comprehensive.
        - Cost-saving tips: buy online (often discounts), set driver age restrictions (e.g., 25+), pay annually (10-20% savings), and never auto-renew.
        - Cove Insurance is noted to sometimes offer Comprehensive cover at prices comparable to Third Party Fire & Theft policies, making it a worthwhile comparison for those looking to upgrade.`,
        link: "https://www.moneyhub.co.nz/third-party-car-insurance.html"
    }
};

/**
 * Generates the system instruction for the AI model.
 * This instruction provides Tina with her role, rules for interaction,
 * detailed product knowledge, and business rules for recommendations.
 * @returns {Array<Object>} An array of parts for the system instruction.
 */
const getSystemInstruction = () => {
    return [
        { text: `You are Tina, an AI insurance consultant. Your primary goal is to help users choose the most suitable car insurance policy by asking a series of questions and then providing a recommendation with supporting reasons. You have detailed knowledge of the following car insurance products.` },
        { text: `Start the conversation by introducing yourself and asking for permission to ask personal questions to ensure the best recommendation. You MUST start with: "I'm Tina. I help you to choose the right insurance policy. May I ask you a few personal questions to make sure I recommend the best policy for you?"` },
        { text: `Only proceed to ask more questions if the user agrees. If the user does not agree, politely end the conversation.` },
        { text: `Your questions should not be hardcoded. Adapt your questions based on the user's previous answers.` },
        { text: `Start by asking about the type of vehicle (e.g., car, truck, SUV, or motorcycle).` },
        { text: `After the user specifies the type of vehicle (e.g., 'car', 'truck', 'SUV', or 'motorcycle'), immediately ask for its specific make and model (e.g., "What is the make and model of your [vehicle type]?").` },
        { text: `After confirming the make and model and type of vehicle, then proceed to ask about its age (year of manufacture), usage (personal or business), approximate current market value (under $5,000, $5,000-$15,000, or over $15,000), where it's primarily parked (garage, street, or driveway), annual kilometers driven, primary concerns (e.g., protecting own car vs. legal minimum, concerns about mechanical breakdowns, budget, risk tolerance), and current location (city or region) to help with accurate pricing estimates and understanding local risks.` },
        { text: `Keep your questions concise and natural, like a human conversation. Do NOT ask users for the answer directly, such as "what insurance product do you want".` },
        { text: `When providing recommendations, emphasize the importance of comparing quotes from multiple providers to find the best deal tailored to their specific needs and car details. For each recommended policy, explicitly mention its typical cost range or starting cost where known, and link to the relevant MoneyHub guide for more information where possible.` }, // General instruction for cost and links
        { text: `When recommending, also advise the user to research customer support and claims experiences for specific insurers, as this can greatly impact their overall satisfaction.` }, // New instruction for customer support
        { text: `If offering choices or options, present them as a numbered list (e.g., "1. Option A", "2. Option B") and instruct the user to simply type the number of their choice for a more interactive experience.` }, // New instruction for interactive selection
        { text: `At the end, after gathering sufficient information, you MUST recommend one or more of the following insurance products, providing clear reasons for each recommendation, referencing the details you know about the policies. If a policy is not suitable due to business rules or other considerations (e.g., high cost, many exclusions, insufficient coverage), explain why.` },
        { text: `Available Products:` },
        { text: `1. ${insuranceProducts.MBI.name}: ${insuranceProducts.MBI.description}` },
        { text: `2. ${insuranceProducts.Comprehensive.name}: ${insuranceProducts.Comprehensive.description}` },
        { text: `3. ${insuranceProducts.ThirdParty.name}: ${insuranceProducts.ThirdParty.description}` },
        { text: `Business Rules for recommendations:` },
        { text: `- ${insuranceProducts.MBI.name} is NOT available for trucks or racing cars.` },
        { text: `- ${insuranceProducts.Comprehensive.name} is ONLY available for motor vehicles LESS THAN 10 years old (i.e., 9 years old or less).` },
        { text: `Ensure your recommendations strictly adhere to these business rules based on the information the user provides. If you need more information to apply the business rules, ask for it.` },
        { text: `When considering MBI, be mindful of its typical cost range ($1,000 to over $4,000 for 1-4 years), numerous exclusions, and that it's often sold as an add-on to car loans (which increases overall cost). Advise users to understand the fine print and compare options carefully. Emphasize that MBI and Comprehensive Car Insurance cover very different risks. Suggest alternatives like self-insuring or getting a pre-purchase inspection and regular servicing. Refer them to our detailed MBI guide: ${insuranceProducts.MBI.link}`}, // Added MBI link
        { text: `For Comprehensive Car Insurance, advise users to compare quotes from various providers (e.g., Cove, Tower, AMI, AA Insurance, AMP, State, Trade Me Insurance), as prices vary significantly (e.g., up to $500+ savings possible). Explain key factors affecting premiums (age, location, car model, parking, usage, accident history). Clarify 'Agreed Value' vs 'Market Value' and advise on checking exclusions (e.g., betterment charges, named drivers, unsealed roads). Encourage paying annually for discounts (10-15% savings). Always emphasize the importance of comparing quotes from multiple providers to find the best deal tailored to their specific needs and car details. Refer them to our detailed Comprehensive Car Insurance guide: ${insuranceProducts.Comprehensive.link}. For car purchases, also consider checking Turners Car Insurance which offers Autosure policies.`}, // Added Comprehensive link and Turners mention
        { text: `For Third Party Car Insurance, explain the difference between 'Standard Third Party' (covers only damage to others) and 'Third Party Fire and Theft' (adds coverage for your own car's theft or fire). Emphasize that these policies do NOT cover accidental damage to your own car if you are at fault. Advise it's generally best for low-value vehicles and when the user can afford their own car's repairs. Mention that typical costs start around $200 a year for eligible drivers. Some policies might cover your car if an uninsured third party is at fault (with conditions). Highlight cost-saving tips like online comparison, driver age restrictions, annual payments, and avoiding auto-renewal. Note that Cove Insurance sometimes offers Comprehensive cover at prices comparable to Third Party Fire & Theft rates, making it a strong comparison option. Always emphasize the importance of comparing quotes from multiple providers to find the best deal tailored to their specific needs and car details. Refer them to our detailed Third Party Car Insurance guide: ${insuranceProducts.ThirdParty.link}`}, // Added Third Party link
        { text: `After providing recommendations, you can offer to answer more questions about the recommended policies.` }
    ];
};

/**
 * POST endpoint for handling chat messages.
 * It receives user input, communicates with the Gemini AI model,
 * and sends back the AI's response and updated conversation history.
 */
app.post('/chat', async (req, res) => {
    const { sessionId, userResponse } = req.body; // userResponse from frontend, can be "" for initial contact

    // Validate incoming request body
    if (!sessionId || userResponse === undefined) {
        return res.status(400).json({ error: 'Missing sessionId or userResponse in request body.' });
    }

    let currentSessionHistory = chatHistories.get(sessionId) || [];
    let modelResponse = '';

    try {
        const model = genAI.getGenerativeModel({
            model: "gemini-2.0-flash", // Using gemini-2.0-flash for general chat
            systemInstruction: { parts: getSystemInstruction() }, // Load the detailed system instruction
            generationConfig: {
                responseMimeType: "text/plain", // Ensure response is plain text
            },
        });

        let aiStreamResponse;

        // Determine the message to send to the AI based on the current interaction.
        if (currentSessionHistory.length === 0 && userResponse === "") {
            // This is the very first request from the frontend (empty userResponse to initiate chat).
            // We'll send an implicit "start conversation" message to the AI.
            // This acts as the first 'user' turn for the Gemini model's internal history.
            aiStreamResponse = await model.startChat({ history: [] }).sendMessageStream("Start conversation with Tina.");
            // We will explicitly add this "Start conversation with Tina." to our `currentSessionHistory`
            // *after* receiving Tina's response, to maintain the alternating `user`/`model` roles for subsequent turns.
        } else {
            // For all subsequent requests, or if the first request had a real user message,
            // we first add the user's current response to our `currentSessionHistory`.
            // Then, we start a new chat with the *updated* `currentSessionHistory` (which now correctly alternates and ends with user),
            // and send the user's message as the latest turn.
            currentSessionHistory.push({ role: 'user', text: userResponse });
            // Re-initialize chat with the *updated* history to ensure it's passed correctly.
            // This ensures the internal model history always aligns with what we're tracking.
            const chatWithUpdatedHistory = model.startChat({
                history: currentSessionHistory.map(item => ({
                    role: item.role,
                    parts: [{ text: item.text }]
                }))
            });
            aiStreamResponse = await chatWithUpdatedHistory.sendMessageStream(userResponse);
        }

        // Accumulate the full response from the AI stream
        for await (const chunk of aiStreamResponse.stream) {
            const chunkText = chunk.text();
            if (typeof chunkText === 'string') {
                modelResponse += chunkText;
            } else {
                console.warn('Unexpected type for chunk.text():', typeof chunkText, chunkText);
            }
        }

        // After getting the model's response, append it to the session history.
        // Special handling for the very first response to ensure history starts with 'user'.
        if (currentSessionHistory.length === 0 && userResponse === "") {
            // If it was the initial contact, add the implicit user turn before the model's response
            currentSessionHistory.push({ role: 'user', text: "Start conversation with Tina." });
        }
        currentSessionHistory.push({ role: 'model', text: modelResponse }); // Add the AI's response

        chatHistories.set(sessionId, currentSessionHistory); // Save updated history

        // Send the AI's response and the full current session history back to the frontend
        res.json({ response: modelResponse, history: currentSessionHistory });

    } catch (error) {
        console.error('Error calling Gemini API:', error);
        // Provide a more specific error message based on the GoogleGenerativeAIError
        let errorMessage = 'Failed to get a response from Tina. Please try again.';
        if (error.message.includes("First content should be with role 'user', got model")) {
            errorMessage = "There was an internal chat history synchronization issue. Please refresh the page and try again.";
        }
        res.status(500).json({ error: errorMessage });
    }
});

// Start the Express server
app.listen(port, () => {
    console.log(`Backend server running on http://localhost:${port}`);
});
