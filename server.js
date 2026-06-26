require("dotenv").config();

const express = require("express");
const session = require("express-session");
const passport = require("passport");
const DiscordStrategy = require("passport-discord").Strategy;
const crypto = require("crypto");
const PORT = process.env.PORT || 3000;

const app = express();
const pendingTokens = new Map();

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(
    new DiscordStrategy(
        {
            clientID: process.env.DISCORD_CLIENT_ID,
            clientSecret: process.env.DISCORD_CLIENT_SECRET,
            callbackURL: process.env.DISCORD_CALLBACK_URL,
            scope: ["identify"],
        },
        (accessToken, refreshToken, profile, done) => {
            return done(null, profile);
        }
    )
);

app.use(
    session({
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
    })
);

app.use(passport.initialize());
app.use(passport.session());
app.use(express.json());

function ensureAuth(req, res, next) {
    if (req.isAuthenticated()) return next();
    res.redirect("/login");
}

app.get("/", (req, res) => {
    res.redirect(req.isAuthenticated() ? "/report" : "/login");
});

app.get("/login", (req, res) => {
    res.send(`
    <h1>Field Reports</h1>
    <p>Sign in with Discord to submit intelligence reports.</p>
    <a href="/auth/discord">Sign in with Discord</a>
  `);
});


// TODO:
// Save to database
// Award tokens
// Forward to Discord
// Notify leadership

app.post("/webhook", async (req, res) => {

    console.log("Incoming report:", req.body);



    const response = req.body;

    const token = response["Submission Token"];

    const pending = pendingTokens.get(token);

    if (!pending) {
        return res.status(403).json({ error: "Invalid submission token" });
    }

    if (Date.now() > pending.expiresAt) {
        pendingTokens.delete(token);
        return res.status(403).json({ error: "Token expired" });
    }

    const field = (name, value, inline = false) => {
        if (!value) return null;
        return {
            name,
            value: String(value),
            inline
        };
    };

    const payload = {
        embeds: [{
            title: `${response["Report Type"] || "Unknown"} Report`,
            fields: [
                field("Reporter", response["Discord Name"]),
            ].filter(Boolean),
            timestamp: new Date().toISOString()
        }]
    };

    const fields = payload.embeds[0].fields;

    switch (response["Report Type"]) {
        case "Ship Fit":
            fields.push(
                field("Name", response["Ship Fit Name"]),
                field("Notes", response["Ship Fit Notes"]),
            );
            break;
        case "Hostile Base":
            fields.push(
                field("Hostile Character Name", response["Hostile Character Name"]),
                field("Tribe", response["Tribe"]),
                field("System", response["System Containing Hostile Base"], true),
                field("Zone", response["Zone Containing Hostile Base"], true),
                field("Notes", response["Notes on Hostile Base"])
            );
            break;
        case "Rift":
            fields.push(
                field("Type", response["Rift Type"]),
                field("System", response["System Containing Rift"], true),
                field("Zone", response["Zone Containing Rift"], true),
            );
            break;
        case "PvE Loot":
            fields.push(
                field("Loot", response["Loot"]),
                field("System", response["System Containing Loot"], true),
                field("Zone", response["Zone Containing Loot"], true),
                field("NPCs", response["NPC Type"]),
                field("Notes", response["Notes on Loot"])
            );
            break;
        case "Resources":
            fields.push(
                field("Resource", response["Resource"]),
                field("System", response["System Containing Resources"], true),
                field("Zone", response["Zone Containing Resource"], true),
                field("Notes", response["Notes on Resources"])
            );
            break;
        case "Area of Interest":
            fields.push(
                field("Of Interest", response["What is of interest?"]),
                field("System", response["System Containing AoI"], true),
                field("Zone", response["Zone Containing AoI"], true),
                field("Notes", response["Notes on AoI"])
            );
            break;
    }

    payload.embeds[0].fields = fields.filter(Boolean);

    const screenshot = response["Screenshots"];

    if (screenshot) {
        const fileValue = Array.isArray(screenshot) ? screenshot[0] : screenshot;

        // If Apps Script sends only a Drive file ID:
        payload.embeds[0].image = {
            url: `https://drive.google.com/uc?export=view&id=${fileValue}`
        };

        // If Apps Script sends a full URL instead, use:
        // payload.embeds[0].url = fileValue;
    }

    console.log("Sending webhook:", payload);
    console.log("Embeds:", payload.embeds[0]);

    await fetch(process.env.DISCORD_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    res.status(200).json({ success: true });
});

app.get("/auth/discord", passport.authenticate("discord"));

app.get(
    "/auth/discord/callback",
    passport.authenticate("discord", { failureRedirect: "/login" }),
    (req, res) => res.redirect("/report")
);

app.get("/report", ensureAuth, async (req, res) => {
    console.log("Got User:", req.user);
    const discordId = req.user.id;
    const token = crypto.randomUUID();

    const guildId = process.env.DISCORD_GUILD_ID;

    const memberRes = await fetch(
        `https://discord.com/api/v10/guilds/${guildId}/members/${discordId}`,
        {
            headers: {
                Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`
            }
        }
    );

    const member = await memberRes.json();

    const serverName =
        member.nick ||
        member.user.global_name ||
        member.user.username;

    const formUrl = new URL(
        "https://docs.google.com/forms/d/e/1FAIpQLScXnFogplgAk7cKpfiqlnZSQj0vtHMxdgn8DvLrTdDvv-pckg/viewform"
    );

    pendingTokens.set(token, {
        serverName,
        expiresAt: Date.now() + 10 * 60 * 1000,
        used: false
    });

    formUrl.searchParams.set("usp", "pp_url");
    formUrl.searchParams.set("entry.1586080761", serverName);
    formUrl.searchParams.set("entry.830012273", token);

    res.redirect(formUrl.toString());
});
app.get("/logout", (req, res) => {
    req.logout(() => res.redirect("/login"));
});

app.listen(PORT, () => {
    console.log(`Running on port ${PORT}`);
});