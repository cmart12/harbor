import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  _resetForTests,
  openNotifDb,
  closeNotifDb,
  addVipSender,
  removeVipSender,
  listVipSenders,
  getVipSender,
  isVipSender,
} from './notif-db';

describe('vip senders', () => {
  beforeEach(() => {
    _resetForTests();
    openNotifDb(':memory:');
  });

  afterEach(() => {
    closeNotifDb();
    _resetForTests();
  });

  it('adds and lists VIP senders', () => {
    const vip = addVipSender('alex@example.com', 'Alex');
    expect(vip.email).toBe('alex@example.com');
    expect(vip.display_name).toBe('Alex');
    expect(listVipSenders().map(sender => sender.email)).toEqual(['alex@example.com']);
  });

  it('matches email lookups case-insensitively', () => {
    addVipSender('Alex@Example.com', 'Alex');
    expect(isVipSender('alex@example.com')).toBe(true);
    expect(isVipSender('ALEX@EXAMPLE.COM')).toBe(true);
    expect(getVipSender('alex@example.com')?.display_name).toBe('Alex');
  });

  it('removeVipSender deletes the row regardless of case', () => {
    addVipSender('Alex@Example.com', 'Alex');
    expect(removeVipSender('alex@example.com')).toBe(true);
    expect(listVipSenders()).toEqual([]);
    expect(isVipSender('Alex@Example.com')).toBe(false);
  });
});
