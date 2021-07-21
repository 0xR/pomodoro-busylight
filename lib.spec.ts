import { alertWithSound, formatTime } from './lib';

it('should format dates', () => {
  expect(formatTime(new Date(2020, 1, 1, 9, 9))).toMatchInlineSnapshot(
    `"09:09"`,
  );
});

it('should alert', async () => {
  await alertWithSound('mock alert text');
});
