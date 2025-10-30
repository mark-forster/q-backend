const { generateToken04 } = require("../util/zegoServerAssistant"); // Correct path to your token generation utility


const ZEGO_APP_ID = process.env.ZEGO_APP_ID ; // Replace with your App ID config
const ZEGO_SECRET = process.env.ZEGO_SERVER_SECRET; // Replace with your App Secret config

const getZegoToken = async (req, res, next) => {
    // Client မှ ပို့လာသော roomID နှင့် userID ကို Body မှ ရယူပါ
    const { roomID, userID } = req.body; 

    // Server-side validation
    if (!roomID || !userID) {
        return res.status(400).json({ error: "roomID and userID are required in the request body." });
    }

    try {
        const appId = Number(ZEGO_APP_ID);
        const secret = ZEGO_SECRET;
        const effectiveTimeInSeconds = 3600; // Token သက်တမ်း (1 hour)

        // Token ကို Generate လုပ်ပါ
        const token = generateToken04(
            appId,
            userID, // Zego SDK မှာ userId လို့ခေါ်တာကို client ကနေပို့တဲ့ userID ကို သုံးပါ
            secret,
            effectiveTimeInSeconds,
            // Payload ကို လိုအပ်မှ ထည့်ပါ (ဥပမာ: Stream permission များ)
            JSON.stringify({ roomID: roomID }) 
        );

        res.status(200).json({
            token: token, // ✅ Client ကို kitToken string အဖြစ် ပြန်ပို့သည်
            roomID: roomID,
            userID: userID
        });

    } catch (error) {
        console.error("Zego Token Generation Error:", error);
        res.status(500).json({ 
            error: "Failed to generate Zego Token.",
            details: error.message 
        });
    }
};


module.exports = { getZegoToken };