/* eslint-env jest */

// NetInfo touches its native module at import time, which is null under Jest.
// The library ships a mock for exactly this; register it globally so any test
// that renders the app (which watches for Wi-Fi to warm the mushaf font store)
// doesn't have to know NetInfo is down there.
jest.mock('@react-native-community/netinfo', () =>
  require('@react-native-community/netinfo/jest/netinfo-mock.js'),
);

// react-native-gesture-handler uses TurboModuleRegistry.getEnforcing at import
// time, which throws in Jest because native modules aren't registered.  Mock the
// entire package before any module loads so the native call never executes.
jest.mock('react-native-gesture-handler', () => {
  const { View, TouchableOpacity, FlatList, Switch, TextInput } =
    require('react-native');
  const noop = jest.fn();
  const makeGesture = () => {
    const g = {};
    const methods = [
      'onBegin', 'onStart', 'onUpdate', 'onEnd', 'onFinalize',
      'onFail', 'onCancel', 'onTouchesDown', 'onTouchesMove', 'onTouchesUp',
      'minDistance', 'maxDuration', 'numberOfTaps', 'direction',
      'simultaneousWithExternalGesture', 'requireExternalGestureToFail',
      'blocksExternalGesture', 'withRef', 'enabled', 'shouldCancelWhenOutside',
      'hitSlop', 'activeCursor', 'mouseButton', 'runOnJS', 'config',
    ];
    methods.forEach(m => { g[m] = jest.fn(() => g); });
    return g;
  };
  return {
    GestureHandlerRootView: View,
    GestureDetector: ({ children }) => children,
    Gesture: {
      Pan: makeGesture, Tap: makeGesture, Fling: makeGesture,
      LongPress: makeGesture, Pinch: makeGesture, Rotation: makeGesture,
      ForceTouch: makeGesture, Native: makeGesture,
      Simultaneous: (...h) => h, Race: (...h) => h, Exclusive: (...h) => h,
    },
    State: { UNDETERMINED: 0, FAILED: 1, BEGAN: 2, CANCELLED: 3, ACTIVE: 4, END: 5 },
    Directions: { RIGHT: 1, LEFT: 2, UP: 4, DOWN: 8 },
    gestureHandlerRootHOC: c => c,
    PanGestureHandler: View, TapGestureHandler: View,
    PinchGestureHandler: View, RotationGestureHandler: View,
    FlingGestureHandler: View, LongPressGestureHandler: View,
    ForceTouchGestureHandler: View, NativeViewGestureHandler: View,
    RawButton: View, BaseButton: View, RectButton: View, BorderlessButton: View,
    Swipeable: View, DrawerLayout: View,
    ScrollView: View, FlatList, Switch, TextInput,
    TouchableHighlight: TouchableOpacity,
    TouchableNativeFeedback: TouchableOpacity,
    TouchableOpacity: TouchableOpacity,
    TouchableWithoutFeedback: View,
    useAnimatedGestureHandler: jest.fn(() => ({})),
    createNativeWrapper: c => c,
    enableExperimentalWebImplementation: noop,
    enableLegacyWebImplementation: noop,
  };
});

jest.mock('@react-native-community/geolocation', () => ({
  __esModule: true,
  default: {
    getCurrentPosition: jest.fn(success =>
      success({ coords: { latitude: 51.5, longitude: -0.12 } }),
    ),
  },
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// react-native-encrypted-storage — task #16. Provides the same async API as
// AsyncStorage with a separate in-memory backing so tests can verify that
// sensitive fields land HERE and never in the AsyncStorage mock above.
//
// `virtual: true` lets Jest mock a module that isn't present in node_modules.
// This makes the test suite pass before the user runs
// `npm install react-native-encrypted-storage` for the native build.
jest.mock(
  'react-native-encrypted-storage',
  () => {
    let secureStore = {};
    return {
      __esModule: true,
      default: {
        setItem: jest.fn(async (key, value) => { secureStore[key] = value; }),
        getItem: jest.fn(async key => secureStore[key] ?? null),
        removeItem: jest.fn(async key => { delete secureStore[key]; }),
        clear: jest.fn(async () => { secureStore = {}; }),
      },
      __reset: () => { secureStore = {}; },
      __peek: () => secureStore,
    };
  },
  { virtual: true },
);

jest.mock('adhan', () => {
  // Realistic in-order prayer times so validateTimings ordering checks pass
  // through the local-adhan code path. Times are deliberately well-separated.
  const Y = 2026, M = 3, D = 9; // April 9, 2026 (local time)
  const at = (h, m) => new Date(Y, M, D, h, m, 0);
  const mk = () => ({ madhab: 'shafi' });
  const names = [
    'Tehran',
    'Karachi',
    'NorthAmerica',
    'MuslimWorldLeague',
    'UmmAlQura',
    'Egyptian',
    'Dubai',
    'Kuwait',
    'Qatar',
    'Singapore',
    'Turkey',
    'MoonsightingCommittee',
  ];
  const CM = {};
  names.forEach(n => {
    CM[n] = mk;
  });
  // Methods adhan.js has no preset for are built from `Other()` and their
  // published angles (localAdhan.ts). This stub ignores the parameters like
  // every other one here — a test that cares about the ARITHMETIC has to
  // unmock, which __tests__/calculationMethods.test.ts does.
  CM.Other = () => ({
    madhab: 'shafi',
    fajrAngle: 0,
    ishaAngle: 0,
    ishaInterval: 0,
    methodAdjustments: { fajr: 0, sunrise: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 },
  });
  return {
    Coordinates: function Coordinates() {},
    Madhab: { Hanafi: 'hanafi', Shafi: 'shafi' },
    CalculationMethod: CM,
    PrayerTimes: function PrayerTimes(_coords, _date, calc) {
      this.fajr = at(4, 30);
      this.sunrise = at(6, 10);
      this.dhuhr = at(12, 0);
      // Hanafi madhab pushes Asr later — reflect that so tests that exercise
      // the school param see different times.
      this.asr = calc && calc.madhab === 'hanafi' ? at(16, 30) : at(15, 30);
      this.maghrib = at(18, 0);
      this.isha = at(20, 0);
    },
  };
});

jest.mock('react-native-share', () => ({
  __esModule: true,
  default: {
    open: jest.fn(() => Promise.resolve({ success: true })),
    shareSingle: jest.fn(() => Promise.resolve({ success: true })),
    isPackageInstalled: jest.fn(() => Promise.resolve({ isInstalled: false })),
  },
  Social: {},
}));

jest.mock('react-native-view-shot', () => ({
  __esModule: true,
  default: 'ViewShot',
  captureRef: jest.fn(() => Promise.resolve('file://mock.png')),
  captureScreen: jest.fn(() => Promise.resolve('file://mock.png')),
}));

// Quran Reader v2 native deps (docs/quran-reader-plan.md). All three are
// mocked wholesale: the JS-level logic they back (queue building, repeat
// expansion, store paths) is unit-tested against these fakes.
jest.mock('@sayem314/react-native-keep-awake', () => ({
  __esModule: true,
  default: () => null,
  activateKeepAwake: jest.fn(),
  deactivateKeepAwake: jest.fn(),
  useKeepAwake: jest.fn(),
}));

jest.mock('react-native-blob-util', () => {
  const files = new Map();
  const fs = {
    dirs: { DocumentDir: '/mock/documents', CacheDir: '/mock/cache' },
    exists: jest.fn(async path => files.has(path)),
    stat: jest.fn(async path => {
      if (!files.has(path)) throw new Error('ENOENT');
      return { size: files.get(path).length, path };
    }),
    lstat: jest.fn(async () => []),
    ls: jest.fn(async () => []),
    readFile: jest.fn(async path => {
      if (!files.has(path)) throw new Error('ENOENT');
      return files.get(path);
    }),
    writeFile: jest.fn(async (path, data) => {
      files.set(path, String(data));
    }),
    unlink: jest.fn(async path => {
      files.delete(path);
    }),
    mv: jest.fn(async (from, to) => {
      files.set(to, files.get(from) ?? '');
      files.delete(from);
    }),
    mkdir: jest.fn(async () => {}),
  };
  return {
    __esModule: true,
    default: {
      fs,
      config: jest.fn(() => ({
        fetch: jest.fn(async () => ({ info: () => ({ status: 200 }) })),
      })),
    },
    __files: files,
  };
});

jest.mock('react-native-track-player', () => ({
  __esModule: true,
  default: {
    setupPlayer: jest.fn(async () => {}),
    updateOptions: jest.fn(async () => {}),
    registerPlaybackService: jest.fn(),
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
    add: jest.fn(async () => {}),
    reset: jest.fn(async () => {}),
    play: jest.fn(async () => {}),
    pause: jest.fn(async () => {}),
    stop: jest.fn(async () => {}),
    seekTo: jest.fn(async () => {}),
    setRate: jest.fn(async () => {}),
    skipToNext: jest.fn(async () => {}),
    skipToPrevious: jest.fn(async () => {}),
    getQueue: jest.fn(async () => []),
    // The gapless prefetch and the listening top-up both walk the queue
    // relative to where playback is, and both hot-swap entries behind it.
    getActiveTrackIndex: jest.fn(async () => 0),
    remove: jest.fn(async () => {}),
  },
  useProgress: jest.fn(() => ({ position: 0, duration: 0, buffered: 0 })),
  usePlaybackState: jest.fn(() => ({ state: 'none' })),
  State: {
    None: 'none',
    Stopped: 'stopped',
    Paused: 'paused',
    Playing: 'playing',
    Loading: 'loading',
    Buffering: 'buffering',
  },
  Event: {
    PlaybackState: 'playback-state',
    PlaybackActiveTrackChanged: 'playback-active-track-changed',
    PlaybackQueueEnded: 'playback-queue-ended',
    RemotePlay: 'remote-play',
    RemotePause: 'remote-pause',
    RemoteNext: 'remote-next',
    RemotePrevious: 'remote-previous',
    RemoteStop: 'remote-stop',
    RemoteSeek: 'remote-seek',
    RemoteDuck: 'remote-duck',
  },
  Capability: {
    Play: 0,
    Pause: 1,
    Stop: 2,
    SeekTo: 3,
    SkipToNext: 4,
    SkipToPrevious: 5,
  },
  AppKilledPlaybackBehavior: {
    StopPlaybackAndRemoveNotification: 'stop-playback-and-remove-notification',
    ContinuePlayback: 'continue-playback',
  },
}));

jest.mock('react-native-sensors', () => ({
  magnetometer: {
    subscribe: jest.fn(() => ({ unsubscribe: jest.fn() })),
  },
  setUpdateIntervalForType: jest.fn(),
  SensorTypes: { magnetometer: 'magnetometer' },
}));

jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  default: {
    cancelTriggerNotifications: jest.fn(() => Promise.resolve()),
    cancelTriggerNotification: jest.fn(() => Promise.resolve()),
    cancelNotification: jest.fn(() => Promise.resolve()),
    createChannel: jest.fn(() => Promise.resolve()),
    deleteChannel: jest.fn(() => Promise.resolve()),
    // Resolves to a channel, because that is what the real one does for a
    // channel this app created — and code that asks "is this channel there?"
    // before posting to it must not be told "no" by the harness. A suite that
    // wants the absent case overrides this locally.
    getChannel: jest.fn(id => Promise.resolve({ id })),
    createTriggerNotification: jest.fn(() => Promise.resolve()),
    displayNotification: jest.fn(() => Promise.resolve()),
    getNotificationSettings: jest.fn(() =>
      Promise.resolve({
        android: { alarm: 1 },
        authorizationStatus: 1,
      }),
    ),
    getTriggerNotifications: jest.fn(() => Promise.resolve([])),
    // The id-only variant, which the rolling-window schedulers (ayah of the
    // day, the khatmah reminder) use to sweep their own previous window.
    // Absent from this mock it threw, was swallowed by their try/catch, and
    // every "did it cancel the old one?" assertion passed for free.
    getTriggerNotificationIds: jest.fn(() => Promise.resolve([])),
    openAlarmPermissionSettings: jest.fn(() => Promise.resolve()),
    // The Quran download's foreground service. Absent from this mock,
    // `stopForegroundService` was `undefined`, the call threw, and
    // downloadNotification's own try/catch swallowed it — so every
    // assertion about tearing the progress bar down passed without the
    // teardown ever being attempted. That is how a bar that outlived its
    // download shipped with a green suite.
    stopForegroundService: jest.fn(() => Promise.resolve()),
    registerForegroundService: jest.fn(),
  },
  TriggerType: { TIMESTAMP: 0, INTERVAL: 1 },
  AndroidStyle: { BIGTEXT: 0, BIGPICTURE: 1, INBOX: 2, MESSAGING: 3 },
  AndroidCategory: { STATUS: 'status', ALARM: 'alarm', REMINDER: 'reminder' },
  AndroidVisibility: { PRIVATE: 0, PUBLIC: 1, SECRET: -1 },
  AndroidImportance: { DEFAULT: 3, HIGH: 4, LOW: 2, MIN: 1, NONE: 0 },
  AndroidForegroundServiceType: { FOREGROUND_SERVICE_TYPE_DATA_SYNC: 1 },
  AndroidNotificationSetting: { DISABLED: 0, ENABLED: 1, NOT_SUPPORTED: -1 },
  AuthorizationStatus: {
    NOT_DETERMINED: -1,
    DENIED: 0,
    AUTHORIZED: 1,
    PROVISIONAL: 2,
    EPHEMERAL: 3,
  },
  AlarmType: {
    SET_EXACT_AND_ALLOW_WHILE_IDLE: 3,
  },
}));
