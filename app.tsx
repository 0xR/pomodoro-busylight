import fs from 'fs-extra';
// @ts-ignore
import { get as getBusylight } from 'busylight';
import { assign, EventObject, Machine } from 'xstate';
import { useMachine } from '@xstate/react';
import { Box, Color, render, Text } from 'ink';
import SelectInput, { Item } from 'ink-select-input';
import React, { ReactElement, useEffect, useMemo, useRef, useState, } from 'react';
// @ts-ignore
import ProgressBar from 'ink-progress-bar';
// @ts-ignore
import BigText from 'ink-big-text';
// @ts-ignore
import { UncontrolledTextInput } from 'ink-text-input';
import { formatMillis, formatTime, getProgress, PomodoroContext } from './lib';
import { useDebouncedCallback } from 'use-debounce';
import winston, { format } from 'winston';

const logger = winston.createLogger({
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss.SSS',
    }),
    format.splat(),
    format.printf(info => {
      return `${info.timestamp} ${info.message}${
        info.error ? ' ' + info.error.stack : ''
      }`;
    }),
  ),
  transports: [
    new winston.transports.File({
      filename: 'debug.log',
      level: 'debug',
      handleExceptions: true,
    }),
  ],
});

process.on('unhandledRejection', (reason, promise) => {
  logger.debug('Unhandled rejection', { error: reason });
});

logger.debug('#### started pomodoro timer ####');

const debug = process.env.npm_lifecyle_event === 'dev';

const blinkingRate = 500;

const workColor = 'red';
const breakColor = 'green';
const meetingColor = 'blue';
const idleColor = 'orange';

function getDailyMeetings() {
  return [
    new Date().setHours(9,13,0,0),
    new Date().setHours(11,57,0,0)
  ];
}

function getNextDailyMeeting(ignoreDailyBefore: number) {
  return getDailyMeetings().sort().find(meeting => meeting > ignoreDailyBefore);
}

const pomodoroMachine = Machine<PomodoroContext, EventObject>(
  {
    id: 'pomodoro',
    initial: 'idle',
    strict: true,
    context: { workDuration: debug ? 5 : 25, breakDuration: 5 },
    states: {
      idle: {
        on: {
          WORK: 'work',
          BREAK: 'break',
          EXIT: 'exit',
        },
      },
      work: {
        on: {
          FINISHED: 'workFinished',
          STOP: 'idle',
        },
        entry: 'setStartTime',
        exit: 'removeStartTime',
      },
      workFinished: {
        on: {
          BREAK: 'break',
          STOP: 'idle',
        },
      },
      break: {
        on: {
          FINISHED: 'breakFinished',
          STOP: 'idle',
        },
        entry: 'setStartTime',
        exit: 'removeStartTime',
      },
      breakFinished: {
        on: {
          WORK: 'work',
          STOP: 'idle',
        },
      },
      configMeetings: {
        on: {
          STOP: 'idle',
        },
      },
      exit: {
        type: 'final',
      },
    },
  },
  {
    actions: {
      setStartTime: assign({
        startTime: (context, _event) => {
          return context.startTime || Date.now();
        },
      }),
      removeStartTime: assign({
        startTime: (_context, _event) => {
          return undefined;
        },
      }),
    },
  },
);

const meetingMachine = Machine<{}, EventObject>({
  id: 'meeting',
  initial: 'idle',
  strict: true,
  states: {
    idle: {
      on: {
        CONFIGMEETINGS: 'configMeetings',
        MEETING: 'meeting',
      },
    },
    configMeetings: {
      on: {
        STOPMEETING: 'idle',
      },
    },
    meeting: {
      on: {
        STOPMEETING: 'idle',
      },
    },
  },
});

const useTime = () => {
  const [time, setTime] = useState<number>(Date.now());
  useEffect(() => {
    const interval = setInterval(() => {
      setTime(Date.now());
    }, 1000);

    return () => {
      clearInterval(interval);
    };
  }, []);
  return time;
};

function formatMeetings(
  meetings: Meeting[],
  currentTime: number,
  meetingError: Error | undefined,
) {
  const formattedMeetings = [...meetings].sort()
    .filter(meeting => meeting > currentTime)
    .map(m => {
    const meetingDate = new Date(m);
    return `${formatMillis(m - currentTime)} (${formatTime(meetingDate)})`;
  });

  const currentDate = new Date(currentTime);

  return `Meetings: ${
    meetings.length ? formattedMeetings.join(', ') : 'none'
  } - Time: ${formatTime(currentDate)}${
    meetingError ? ' ' + meetingError.toString() : ''
  }`;
}

type Mode = 'blinking' | 'progress';

const Header = ({
  currentTime,
  mode,
  color,
}: {
  currentTime: number;
  mode: Mode;
  color: string;
}) => {
  const texts = ['PO', 'MO', 'DO', 'RO'];
  const rateCount = Math.round(currentTime / (2 * blinkingRate));
  const highlightColor = 'white';
  const colors =
    mode === 'blinking'
      ? rateCount % 2
        ? Array(texts.length).fill(highlightColor)
        : Array(texts.length).fill(color)
      : texts.map((text, i) => {
          return rateCount % texts.length === i ? highlightColor : color;
        });
  return (
    <Box>
      {texts.map((text, i) => (
        <Box key={i} marginLeft={i && -1}>
          <Color keyword={colors[i]}>
            <BigText text={text} />
          </Color>
        </Box>
      ))}
    </Box>
  );
};

interface PersistState {
  meetings: Meeting[];
  ignoreDailyMeetingsBefore: number;
  pomodoroState: { state: string; context: PomodoroContext } | undefined;
}

function usePersistedState<T>(
  initialState: T,
  path: string,
): [T | 'loading', (state: Partial<T>) => void, Error | undefined] {
  const [state, setState] = useState<T | 'loading'>('loading');
  const [error, setError] = useState<Error | undefined>(undefined);

  useEffect(() => {
    (async () => {
      try {
        if (await fs.pathExists(path)) {
          const storedState = await fs.readJSON(path);
          setState({
            ...initialState,
            ...storedState });
        } else {
          setState(initialState);
        }
      } catch (e) {
        logger.error('Error reading JSON', e);
        setError(e);
      }
    })();
  }, []);

  const [writeState] = useDebouncedCallback(async () => {
    try {
      await fs.writeJSON(path, state);
      logger.debug('persistedState written %o', state);
    } catch (e) {
      logger.error('Error writing JSON', e);
      setError(e);
    }
  }, 200);

  async function setAndWriteState(newStateSlice: Partial<T>) {
    const newState = {
      ...(state === 'loading' ? initialState : state),
      ...newStateSlice,
    };
    setState(newState);
    await writeState();
  }

  return [state, setAndWriteState, error];
}

const useMeetings = ({
  meetings,
  onChangeMeetings,
}: {
  meetings: Meeting[];
  onChangeMeetings: (meetings: Meeting[]) => void;
}) => {
  const [error, setError] = useState<string>('');
  return {
    error,
    addMeeting(input: string) {
      const parsed = parseInt(input, 10);
      if (!parsed) {
        setError(`Not a number "${input}"`);
        return;
      }
      const hours = Math.floor(parsed / 100);
      const min = parsed % 100;
      if (0 > hours || hours > 23) {
        setError(`Invalid hour "${input}"`);
        return;
      }
      if (0 > min || min > 59) {
        setError(`Invalid minute "${input}"`);
        return;
      }
      setError('');
      const meetingDate = new Date();
      meetingDate.setHours(hours, min, 0, 0);
      const newMeeting = meetingDate.getTime();
      if (newMeeting <= Date.now()) {
        setError(`In the passed: "${input}"`);
        return;
      }
      const result = [...meetings, newMeeting];
      result.sort();
      onChangeMeetings(result);
    },
    removeMeeting(toRemove: Meeting) {
      onChangeMeetings(meetings.filter(meeting => meeting != toRemove));
    },
  };
};

type Meeting = number;

const ConfigMeetings = ({
  meetings,
  onChangeMeetings,
  onDone,
}: {
  meetings: Meeting[];
  onChangeMeetings: (meetings: Meeting[]) => void;
  onDone: () => void;
}) => {
  const [state, setState] = useState<'home' | 'add' | 'remove'>('home');
  const { error, addMeeting, removeMeeting } = useMeetings({
    meetings,
    onChangeMeetings,
  });

  return (
    <>
      {error && <Text>{error}</Text>}
      {state === 'home' ? (
        <SelectInput
          items={[
            {
              label: 'Add meeting',
              value: 'add',
            },
            {
              label: 'remove',
              value: 'remove',
            },
            {
              label: 'exit',
              value: 'exit',
            },
          ]}
          onSelect={(item: Item) => {
            if (item.value === 'add') {
              setState('add');
            }
            if (item.value === 'remove') {
              setState('remove');
            }
            if (item.value === 'exit') {
              onDone();
            }
          }}
        />
      ) : state === 'remove' ? (
        <SelectInput
          items={[
            ...meetings.map(meeting => ({
              label: formatTime(new Date(meeting)),
              value: meeting,
            })),
            {
              label: 'Back',
              value: 'back',
            },
          ]}
          onSelect={(item: Item) => {
            if (item.value === 'back') {
              setState('home');
            } else {
              removeMeeting(item.value as number);
            }
          }}
        />
      ) : (
        <Box>
          <Box marginRight={1}>Enter meeting time:</Box>
          <UncontrolledTextInput
            onSubmit={value => {
              addMeeting(value);
              setState('home');
            }}
          />
        </Box>
      )}
    </>
  );
};

function usePrevious<T>(value: T): T | undefined {
  // The ref object is a generic container whose current property is mutable ...
  // ... and can hold any value, similar to an instance property on a class
  const ref = useRef<T | undefined>();

  // Store current value in ref
  useEffect(() => {
    ref.current = value;
  }, [value]); // Only re-run if value changes

  // Return previous value (happens before update in useEffect above)
  return ref.current;
}

interface PomodoroStateRenderProps {
  persistedState: PersistState;
  setPersistedState: (state: Partial<PersistState>) => void;
  persistError: Error | undefined;
}
interface ColorInfo {
  mode: Mode;
  color: string;
}
function useColorInfo(pomodoroState: string, meetingState: string): ColorInfo {
  const [connectCount, setConnectCount] = useState(0);
  const busylight = useMemo(() => {
    const newBusylight = getBusylight();
    newBusylight.defaults({
      rate: blinkingRate,
    });

    // @ts-ignore
    newBusylight.on('disconnected', (error: Error) => {
      logger.debug('Busylight disconnected', { error });
    });

    // @ts-ignore
    newBusylight.on('connected', () => {
      logger.debug('Busylight connected');
      setConnectCount(currentConnectCount => currentConnectCount + 1);
    });

    return newBusylight;
  }, []);
  const mode =
    pomodoroState === 'work' ||
    pomodoroState === 'break' ||
    pomodoroState === 'meeting'
      ? 'progress'
      : 'blinking';
  const color =
    meetingState === 'meeting' || meetingState === 'configMeetings'
      ? meetingColor
      : pomodoroState === 'work' || pomodoroState === 'breakFinished'
      ? workColor
      : pomodoroState === 'break' || pomodoroState === 'workFinished'
      ? breakColor
      : idleColor;

  useEffect(() => {
    logger.debug('setting busylight %s, %s, %d', mode, color, connectCount);
    busylight[mode === 'blinking' ? 'pulse' : 'light'](color);
  }, [mode, color, connectCount]);
  return { mode, color };
}

const PomodoroTimer = ({
  persistedState,
  setPersistedState,
  persistError,
}: PomodoroStateRenderProps): ReactElement => {
  const currentTime = useTime();
  const [pomodoroMachineState, sendPomodoro] = useMachine(pomodoroMachine, {
    context: persistedState.pomodoroState?.context,
  });

  const [meetingMachineState, sendMeeting] = useMachine(meetingMachine, {});

  const { context, nextEvents: pomodoroNextEvents } = pomodoroMachineState;
  const { nextEvents: meetingNextEvents } = meetingMachineState;

  const pomodoroState = pomodoroMachineState.value.toString();
  const meetingState = meetingMachineState.value.toString();

  useEffect(() => {
    const state = persistedState.pomodoroState?.state;
    if (state === 'work') {
      sendPomodoro({
        type: 'WORK',
      });
    }
    if (state === 'break') {
      sendPomodoro({
        type: 'BREAK',
      });
    }
  }, []);

  useEffect(() => {
    if (pomodoroState === 'work' || pomodoroState === 'break') {
      setPersistedState({
        pomodoroState: {
          state: pomodoroState,
          context,
        },
      });
    } else {
      setPersistedState({
        pomodoroState: undefined,
      });
    }
  }, [pomodoroState]);

  useEffect(() => {
    if (pomodoroState === 'exit') {
      // unmount();
    }
  }, [pomodoroState]);

  const progress = getProgress({
    state: pomodoroState,
    context,
    currentTime,
  });

  const { meetings, ignoreDailyMeetingsBefore } = persistedState;

  useEffect(() => {
    if (progress && progress.percent <= 0) {
      sendPomodoro({
        type: 'FINISHED',
      });
    }
  }, [progress]);

  useEffect(() => {
    const nextDailyMeeting = getNextDailyMeeting(ignoreDailyMeetingsBefore);
    const dailyMeetingStarted = nextDailyMeeting ? currentTime > nextDailyMeeting : false;

    const meetingStarted = currentTime > meetings[0];

    if (meetingStarted || dailyMeetingStarted) {
      if (meetingStarted) {
        setPersistedState({ meetings: meetings.slice(1) });
      }
      sendMeeting({
        type: 'MEETING',
      });
    }
  }, [currentTime, meetings[0]]);

  const timePassedText = progress ? formatMillis(progress.millis) : '';
  const { mode, color } = useColorInfo(pomodoroState, meetingState);
  return (
    <>
      <Header currentTime={currentTime} mode={mode} color={color} />
      <Text>{formatMeetings([...meetings, ...getDailyMeetings()], currentTime, persistError)}</Text>
      {meetingState === 'configMeetings' ? (
        <ConfigMeetings
          meetings={meetings}
          onChangeMeetings={meetings => {
            setPersistedState({ meetings });
          }}
          onDone={() => {
            sendMeeting({
              type: 'STOPMEETING',
            });
          }}
        />
      ) : (
        <>
          {progress && (
            <Color keyword={pomodoroState === 'work' ? workColor : breakColor}>
              <Box>
                <Box marginRight={1}>{timePassedText}</Box>
                <ProgressBar
                  left={timePassedText.length + 1}
                  percent={progress?.percent}
                />
              </Box>
            </Color>
          )}
          <SelectInput
            items={[
              ...pomodoroNextEvents.map(eventType => ({
                eventType,
                machine: 'Pomodoro',
              })),
              ...meetingNextEvents.map(eventType => ({
                eventType,
                machine: `meeting`,
              })),
            ]
              .filter(({ eventType }) => eventType !== 'FINISHED')
              .filter(({ eventType }) => eventType !== 'MEETING')
              .map(({ eventType, machine }) => ({
                label: `${machine}: Go to ${eventType}`,
                value: eventType,
              }))}
            onSelect={(item: Item) => {
              if (
                item.value === 'CONFIGMEETINGS' ||
                item.value === 'STOPMEETING'
              ) {
                if (item.value === 'STOPMEETING') {
                  setPersistedState({
                    ignoreDailyMeetingsBefore: Date.now(),
                  });
                }
                sendMeeting({
                  type: item.value.toString(),
                });
              } else {
                sendPomodoro({
                  type: item.value.toString(),
                });
              }
            }}
          />
        </>
      )}
    </>
  );
};

const PomodoroState = ({
  children,
}: {
  children: ({
    persistedState,
    setPersistedState,
    persistError,
  }: PomodoroStateRenderProps) => ReactElement;
}): ReactElement => {
  const [persistedState, setPersistedState, persistError] = usePersistedState<
    PersistState
  >(
    {
      meetings: [],
      ignoreDailyMeetingsBefore: Date.now(),
      pomodoroState: undefined,
    },
    `${process.env.HOME}/.pomodoro.json`,
  );

  if (persistedState === 'loading') {
    return <Text>Loading state from file...</Text>;
  }
  return children({ persistedState, setPersistedState, persistError });
};

const { unmount } = render(
  <PomodoroState>
    {renderProps => <PomodoroTimer {...renderProps} />}
  </PomodoroState>,
);

// (async function() {
//   busylight.light('red');
//
//   await new Promise(resolve => {
//     setTimeout(resolve, 1e8);
//   });
// })();
