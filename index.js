require("dotenv").config();
const express = require("express");
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} = require("discord.js");
const moment = require("moment-timezone");

const app = express();
const PORT = process.env.PORT || 3000;

// Set up a simple HTTP server
app.get("/", (req, res) => {
  res.send("Bot is running!");
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const TOKEN = process.env.BOT_TOKEN;
let userSettings = {}; // { userId: { alias: "", notAllowedTime: "", channelId: "", timezone: "" } }
let superDcSettings = {}; // { userId: { alias: "", timeRange: "", timezone: "" } }
let targetChannels = []; // [{ channelId: "", alias: "" }]
let logChannelId = null; // Channel ID for logging
let modUsers = new Set(); // Set of user IDs with permission to modify settings

const commands = [
  new SlashCommandBuilder()
    .setName("setuser")
    .setDescription("Set a user with disconnection settings.")
    .addStringOption((option) =>
      option.setName("userid").setDescription("User ID").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("alias").setDescription("User alias").setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("notallowedtime")
        .setDescription("Not allowed time range (HH:MM-HH:MM)")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("channelid").setDescription("Channel ID").setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("timezone")
        .setDescription("Timezone (default: Asia/Kolkata)")
        .setRequired(false)
    )
    .setDefaultMemberPermissions(0x00000008), // Admin permission
  new SlashCommandBuilder()
    .setName("removeuser")
    .setDescription("Remove a user from disconnection settings.")
    .addStringOption((option) =>
      option.setName("userid").setDescription("User ID").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("channelid").setDescription("Channel ID").setRequired(true)
    )
    .setDefaultMemberPermissions(0x00000008), // Admin permission
  new SlashCommandBuilder()
    .setName("setchannels")
    .setDescription("Set the list of channels to monitor.")
    .addStringOption((option) =>
      option
        .setName("channelids")
        .setDescription("Comma-separated list of channel IDs")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("aliases")
        .setDescription("Comma-separated list of channel aliases")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(0x00000008), // Admin permission
  new SlashCommandBuilder()
    .setName("userlist")
    .setDescription("List all users with disconnection settings.")
    .setDefaultMemberPermissions(0x00000008), // Admin permission
  new SlashCommandBuilder()
    .setName("addedchannels")
    .setDescription("List all monitored channels.")
    .setDefaultMemberPermissions(0x00000008), // Admin permission
  new SlashCommandBuilder()
    .setName("setlogchannel")
    .setDescription("Set the channel for logging bot actions.")
    .addStringOption((option) =>
      option.setName("channelid").setDescription("Channel ID").setRequired(true)
    )
    .setDefaultMemberPermissions(0x00000008), // Admin permission
  new SlashCommandBuilder()
    .setName("superdc")
    .setDescription("Disconnect a user from any channel during a time range.")
    .addStringOption((option) =>
      option.setName("userid").setDescription("User ID").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("alias").setDescription("User alias").setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("timerange")
        .setDescription("Time range (HH:MM-HH:MM)")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("timezone")
        .setDescription("Timezone (default: Asia/Kolkata)")
        .setRequired(false)
    )
    .setDefaultMemberPermissions(0x00000008), // Admin permission
  new SlashCommandBuilder()
    .setName("removesuperdc")
    .setDescription("Remove a user from super disconnection settings.")
    .addStringOption((option) =>
      option.setName("userid").setDescription("User ID").setRequired(true)
    )
    .setDefaultMemberPermissions(0x00000008), // Admin permission
  new SlashCommandBuilder()
    .setName("addmod")
    .setDescription("Add a user as a bot moderator.")
    .addStringOption((option) =>
      option.setName("userid").setDescription("User ID").setRequired(true)
    )
    .setDefaultMemberPermissions(0x00000008), // Admin permission
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Display help information about the bot."),
];

const rest = new REST({ version: "10" }).setToken(TOKEN);

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}!`);
  try {
    console.log("Started refreshing application (/) commands.");
    await rest.put(Routes.applicationCommands(client.user.id), {
      body: commands,
    });
    console.log("Successfully reloaded application (/) commands.");
  } catch (error) {
    console.error(error);
  }
  setInterval(checkTimeAndDisconnect, 60 * 1000); // Check every minute
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isCommand()) return;

  const { commandName } = interaction;

  // Check if the user is a moderator
  if (
    !modUsers.has(interaction.user.id) &&
    commandName !== "addmod" &&
    commandName !== "help"
  ) {
    return interaction.reply("You do not have permission to use this command.");
  }

  if (commandName === "setuser") {
    const userId = interaction.options.getString("userid").trim();
    const alias = interaction.options.getString("alias").trim();
    const notAllowedTime = interaction.options
      .getString("notallowedtime")
      .trim();
    const channelId = interaction.options.getString("channelid").trim();
    const timezone =
      interaction.options.getString("timezone") || "Asia/Kolkata";

    if (!/^\d{2}:\d{2}-\d{2}:\d{2}$/.test(notAllowedTime)) {
      return interaction.reply("Invalid time range format. Use HH:MM-HH:MM.");
    }

    userSettings[userId] = { alias, notAllowedTime, channelId, timezone };
    await interaction.reply(
      `User ${alias} set with not allowed time ${notAllowedTime} in channel ${channelId} with timezone ${timezone}.`
    );
  }

  if (commandName === "removeuser") {
    const userId = interaction.options.getString("userid").trim();
    const channelId = interaction.options.getString("channelid").trim();

    if (userSettings[userId] && userSettings[userId].channelId === channelId) {
      delete userSettings[userId];
      await interaction.reply(
        `User ${userId} removed from channel ${channelId}.`
      );
    } else {
      await interaction.reply(
        `User ${userId} not found in channel ${channelId}.`
      );
    }
  }

  if (commandName === "setchannels") {
    const channelIds = interaction.options
      .getString("channelids")
      .split(",")
      .map((id) => id.trim());
    const aliases = interaction.options
      .getString("aliases")
      .split(",")
      .map((alias) => alias.trim());

    if (channelIds.length !== aliases.length) {
      return interaction.reply(
        "The number of channel IDs and aliases must match."
      );
    }

    targetChannels = channelIds.map((id, index) => ({
      channelId: id,
      alias: aliases[index],
    }));
    await interaction.reply(
      `Target channels set to: ${targetChannels
        .map((c) => `${c.alias} (${c.channelId})`)
        .join(", ")}`
    );
  }

  if (commandName === "userlist") {
    const regularUsers = Object.entries(userSettings).map(
      ([userId, { alias, notAllowedTime, channelId, timezone }]) =>
        `${alias} (${userId}): ${notAllowedTime} in channel ${channelId} (Timezone: ${timezone})`
    );

    const superDcUsers = Object.entries(superDcSettings).map(
      ([userId, { alias, timeRange, timezone }]) =>
        `${alias} (${userId}): Super DC during ${timeRange} (Timezone: ${timezone})`
    );

    const userList = [...regularUsers, ...superDcUsers].join("\n");
    await interaction.reply(`**User List:**\n${userList || "No users set."}`);
  }

  if (commandName === "addedchannels") {
    const channelList = targetChannels
      .map((c) => `${c.alias} (${c.channelId})`)
      .join("\n");
    await interaction.reply(
      `**Monitored Channels:**\n${channelList || "No channels set."}`
    );
  }

  if (commandName === "setlogchannel") {
    logChannelId = interaction.options.getString("channelid").trim();
    await interaction.reply(`Log channel set to: ${logChannelId}`);
  }

  if (commandName === "superdc") {
    const userId = interaction.options.getString("userid").trim();
    const alias = interaction.options.getString("alias").trim();
    const timeRange = interaction.options.getString("timerange").trim();
    const timezone =
      interaction.options.getString("timezone") || "Asia/Kolkata";

    if (!/^\d{2}:\d{2}-\d{2}:\d{2}$/.test(timeRange)) {
      return interaction.reply("Invalid time range format. Use HH:MM-HH:MM.");
    }

    superDcSettings[userId] = { alias, timeRange, timezone };
    await interaction.reply(
      `User ${alias} set to be disconnected during ${timeRange} with timezone ${timezone}.`
    );
  }

  if (commandName === "removesuperdc") {
    const userId = interaction.options.getString("userid").trim();

    if (superDcSettings[userId]) {
      delete superDcSettings[userId];
      await interaction.reply(
        `User ${userId} removed from super disconnection settings.`
      );
    } else {
      await interaction.reply(
        `User ${userId} not found in super disconnection settings.`
      );
    }
  }

  if (commandName === "addmod") {
    const userId = interaction.options.getString("userid").trim();
    modUsers.add(userId);
    await interaction.reply(`User ${userId} added as a bot moderator.`);
  }

  if (commandName === "help") {
    await interaction.reply(
      "**Bot Commands:**\n" +
        "/setuser userid, alias, notallowedtime, channelid, [timezone] - Set user disconnection settings.\n" +
        "/removeuser userid, channelid - Remove user from disconnection settings.\n" +
        "/setchannels channelids, aliases - Set channels to monitor with aliases.\n" +
        "/userlist - List all users with settings.\n" +
        "/addedchannels - List all monitored channels.\n" +
        "/setlogchannel channelid - Set the logging channel.\n" +
        "/superdc userid, timerange, [timezone] - Disconnect user from any channel during a time range.\n" +
        "/removesuperdc userid - Remove user from super disconnection settings.\n" +
        "/addmod userid - Add a user as a bot moderator.\n" +
        "/help - Display this help message.\n" +
        "\nMade with ❤️ by [ybtheflash](https://ybtheflash.in)"
    );
  }
});

client.on("voiceStateUpdate", (oldState, newState) => {
  const userId = newState.id;
  const now = moment().tz("Asia/Kolkata");
  const currentTime = now.format("HH:mm");

  // Check for regular disconnection settings
  if (
    userSettings[userId] &&
    userSettings[userId].channelId === newState.channelId
  ) {
    const { notAllowedTime, alias, timezone } = userSettings[userId];
    const [start, end] = notAllowedTime.split("-");
    const userTime = moment().tz(timezone || "Asia/Kolkata");

    if (userTime.isBetween(moment(start, "HH:mm"), moment(end, "HH:mm"))) {
      newState.disconnect();
      logAction(
        `Disconnected ${alias} (${userId}) from channel ${newState.channelId}.`
      );
    }
  }

  // Check for super disconnection settings
  if (superDcSettings[userId]) {
    const { timeRange, alias, timezone } = superDcSettings[userId];
    const [start, end] = timeRange.split("-");
    const userTime = moment().tz(timezone || "Asia/Kolkata");

    if (userTime.isBetween(moment(start, "HH:mm"), moment(end, "HH:mm"))) {
      newState.disconnect();
      logAction(`Super disconnected ${alias} (${userId}) from any channel.`);
    }
  }
});

function checkTimeAndDisconnect() {
  const now = moment().tz("Asia/Kolkata");
  const currentTime = now.format("HH:mm");

  for (const [userId, settings] of Object.entries(userSettings)) {
    const { notAllowedTime, alias, channelId, timezone } = settings;
    const [start, end] = notAllowedTime.split("-");
    const userTime = moment().tz(timezone || "Asia/Kolkata");
    const member = client.guilds.cache
      .map((guild) => guild.members.cache.get(userId))
      .find((m) => m);

    if (member && member.voice.channelId === channelId) {
      if (userTime.isBetween(moment(start, "HH:mm"), moment(end, "HH:mm"))) {
        member.voice.disconnect();
        logAction(
          `Disconnected ${alias} (${userId}) from channel ${channelId}.`
        );
      } else if (currentTime === start || currentTime === end) {
        sendWarningMessage(member, 15);
      } else if (currentTime === start || currentTime === end) {
        sendWarningMessage(member, 5);
      }
    }
  }

  for (const [userId, settings] of Object.entries(superDcSettings)) {
    const { timeRange, alias, timezone } = settings;
    const [start, end] = timeRange.split("-");
    const userTime = moment().tz(timezone || "Asia/Kolkata");
    const member = client.guilds.cache
      .map((guild) => guild.members.cache.get(userId))
      .find((m) => m);

    if (member && member.voice.channelId) {
      if (userTime.isBetween(moment(start, "HH:mm"), moment(end, "HH:mm"))) {
        member.voice.disconnect();
        logAction(`Super disconnected ${alias} (${userId}) from any channel.`);
      } else if (currentTime === start || currentTime === end) {
        sendWarningMessage(member, 15);
      } else if (currentTime === start || currentTime === end) {
        sendWarningMessage(member, 5);
      }
    }
  }
}

function sendWarningMessage(member, minutes) {
  member
    .send(`You will be disconnected in ${minutes} minutes.`)
    .catch(console.error);
}

function logAction(message) {
  if (logChannelId) {
    const logChannel = client.channels.cache.get(logChannelId);
    if (logChannel) {
      logChannel.send(message).catch(console.error);
    }
  }
}

client.login(TOKEN);
