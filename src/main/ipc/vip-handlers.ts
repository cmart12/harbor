import { registerHandler } from './typed-handler';
import { sendToAllWindows } from './typed-handler';
import {
  addVipSender,
  removeVipSender,
  listVipSenders,
} from '../notif-db';

export function registerVipHandlers(): void {
  registerHandler('vip:list', () => {
    return listVipSenders();
  });

  registerHandler('vip:add', (_event, input) => {
    const sender = addVipSender(input.email, input.displayName);
    sendToAllWindows('vip:changed');
    return sender;
  });

  registerHandler('vip:remove', (_event, email) => {
    removeVipSender(email);
    sendToAllWindows('vip:changed');
    return { ok: true as const };
  });
}
