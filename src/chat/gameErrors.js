// what the game-server API's error codes mean, in words
export const GAME_ERRORS = {
  instance_not_linked: "That Minecraft server isn't linked to this Ember server.", already_linked: 'That Minecraft server is already linked.',
  too_many_instances: 'An Ember server can link up to 10 Minecraft servers.', console_needs_ember: 'Commands can only be run from Ember itself.',
  not_a_console: "This isn't a console channel.", claim_not_found: 'That code is gone - get a new one.', empty_command: 'Type a command first.',
  bad_purpose: 'Pick what the channel is for.', not_linked: "That server isn't linked any more.", not_a_game_channel: "That isn't a game server channel.",
};
