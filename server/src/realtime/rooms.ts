/** Room holding every socket that should receive a channel's events. */
export const channelRoom = (channelId: string) => `channel:${channelId}`;
/** Room holding every socket (all tabs, all instances) of one user. */
export const userRoom = (userId: string) => `user:${userId}`;
