import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import confetti from 'canvas-confetti';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  User as FirebaseUser,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  writeBatch,
} from 'firebase/firestore';
import {
  auth,
  db,
  googleProvider,
  OperationType,
  handleFirestoreError,
} from '../firebase';
import {
  AppRoute,
  UserProfile,
  CompanionMode,
  HouseProject,
  HouseType,
  ConstructionStage,
  ChatMessage,
  MoodRecord,
  MoodType,
  WellbeingCheckinPrompt,
  CityAchievement,
} from '../types';
import { soundEngine, playBrickEarnedSound } from '../utils/soundEngine';

export interface GoogleSignInOutcome {
  isNewUser: boolean;
  email: string;
  displayName: string;
  uid: string;
}

interface AppContextType {
  // Navigation
  currentRoute: AppRoute;
  navigateTo: (route: AppRoute) => void;
  goBack: () => void;
  navigationHistory: AppRoute[];

  // User & Auth
  user: UserProfile | null;
  firebaseUser: FirebaseUser | null;
  isAuthReady: boolean;
  signInWithGoogle: () => Promise<GoogleSignInOutcome>;
  registerUser: (profile: Partial<UserProfile>) => Promise<void>;
  updateUserPreferences: (prefs: Partial<UserProfile['preferences']>) => void;
  logout: () => Promise<void>;
  resetToCleanSlate: () => void;

  // Companion Chat
  companionMode: CompanionMode;
  setCompanionMode: (mode: CompanionMode) => void;
  messages: ChatMessage[];
  sendMessage: (text: string) => Promise<void>;
  clearChat: () => void;
  isAiTyping: boolean;
  activeBrickCelebration: { reason: string } | null;
  clearBrickCelebration: () => void;

  // House Construction & City
  currentHouse: HouseProject | null;
  completedHouses: HouseProject[];
  selectHouseForConstruction: (houseType: HouseType, name: string) => void;
  totalBricksEarned: number;
  bricksUsedInCurrentHouse: number;

  // Mood History & Wellbeing
  moodRecords: MoodRecord[];
  addMoodRecord: (mood: MoodType, intensity: number, note?: string, tags?: string[]) => void;
  wellbeingPrompt: WellbeingCheckinPrompt | null;
  handleWellbeingResponse: (response: 'im_okay' | 'need_talk' | 'take_break' | 'remind_later') => void;
  dismissWellbeingPrompt: () => void;

  // Spotify & Ambient Audio
  ambientType: 'cafe' | 'rain' | 'forest' | 'chimes' | 'none';
  setAmbientType: (type: 'cafe' | 'rain' | 'forest' | 'chimes' | 'none') => void;
  ambientVolume: number;
  setAmbientVolume: (vol: number) => void;
  isSpotifyConnected: boolean;
  toggleSpotifyConnect: () => void;
  spotifyUri: string;
  setSpotifyUri: (uri: string) => void;

  // Achievements
  achievements: CityAchievement[];
}

const AppContext = createContext<AppContextType | null>(null);

const STORAGE_KEY = 'spashta_clean_v3';

const STAGE_ORDER: ConstructionStage[] = [
  'foundation',
  'walls',
  'windows-doors',
  'roof',
  'interior',
  'landscaping',
  'completed',
];

function createWelcomeMessage(): ChatMessage {
  const now = new Date();
  return {
    id: 'msg_welcome_' + now.getTime(),
    sender: 'spashta',
    text: "Hi there! I'm SPASHTA. Think of me as your calm corner of the world — somewhere you can talk freely, unpack messy thoughts, or just share what's on your mind today. How are you feeling right now? ✨",
    timestamp: now.toISOString(),
    formattedTime: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    mode: 'friend',
    reactions: ['✨', '💛'],
  };
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentRoute, setCurrentRoute] = useState<AppRoute>('welcome');
  const [navHistory, setNavHistory] = useState<AppRoute[]>(['welcome']);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  // Track if profile doc is confirmed in Firestore before writing subcollections
  const firestoreUserReadyRef = useRef<string | null>(null);

  // User Profile
  const [user, setUser] = useState<UserProfile | null>(() => {
    const saved = localStorage.getItem(STORAGE_KEY + '_user');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return null;
      }
    }
    return null;
  });

  // Companion Mode
  const [companionMode, setCompanionModeState] = useState<CompanionMode>('friend');

  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY + '_chat');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch {
        // fallback
      }
    }
    return [createWelcomeMessage()];
  });
  const [isAiTyping, setIsAiTyping] = useState(false);
  const [activeBrickCelebration, setActiveBrickCelebration] = useState<{ reason: string } | null>(null);

  const [totalBricksEarned, setTotalBricksEarned] = useState<number>(() => {
    const saved = localStorage.getItem(STORAGE_KEY + '_bricks');
    return saved ? parseInt(saved, 10) : 0;
  });

  const [currentHouse, setCurrentHouse] = useState<HouseProject | null>(() => {
    const saved = localStorage.getItem(STORAGE_KEY + '_house');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // fallback
      }
    }
    const now = new Date();
    return {
      id: 'house_' + now.getTime(),
      houseType: 'cozy-cottage',
      name: 'Cozy Cottage of Calm',
      bricksUsed: 0,
      totalBricksRequired: 12,
      stage: 'foundation',
      percentage: 0,
      startedAt: now.toISOString(),
      reflectionLog: [],
    };
  });

  const [completedHouses, setCompletedHouses] = useState<HouseProject[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY + '_city');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // fallback
      }
    }
    return [];
  });

  const [moodRecords, setMoodRecords] = useState<MoodRecord[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY + '_moods');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // fallback
      }
    }
    return [];
  });

  const [wellbeingPrompt, setWellbeingPrompt] = useState<WellbeingCheckinPrompt | null>(null);

  const [ambientType, setAmbientTypeState] = useState<'cafe' | 'rain' | 'forest' | 'chimes' | 'none'>('none');
  const [ambientVolume, setAmbientVolumeState] = useState<number>(0.4);
  const [isSpotifyConnected, setIsSpotifyConnected] = useState<boolean>(true);
  const [spotifyUri, setSpotifyUri] = useState<string>('37i9dQZF1DX8CwbKo0ScvJ');

  const [achievements] = useState<CityAchievement[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY + '_achievements');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // fallback
      }
    }
    return [
      {
        id: 'ach_arrival',
        title: 'Arrival in Fairytale Land',
        description: 'Began your journey towards clarity in SPASHTA.',
        iconName: 'Sparkles',
        unlockedAt: new Date().toLocaleDateString(),
      },
    ];
  });

  // Load user's Firestore data securely
  async function loadUserWorkspaceFromFirestore(uid: string): Promise<boolean> {
    const userDocPath = `users/${uid}`;
    let userSnap;
    try {
      userSnap = await getDoc(doc(db, 'users', uid));
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, userDocPath);
    }

    if (!userSnap.exists()) {
      firestoreUserReadyRef.current = null;
      return false;
    }

    firestoreUserReadyRef.current = uid;
    const data = userSnap.data();
    const loadedProfile: UserProfile = {
      id: data.uid || uid,
      fullName: data.fullName || 'Traveler',
      email: data.email || '',
      age: Number(data.age || 21),
      isMinor: Boolean(data.isMinor),
      guardianEmail: data.guardianEmail,
      guardianConsentGiven: Boolean(data.guardianConsentGiven),
      isEmailVerified: Boolean(data.isEmailVerified),
      joinedAt: data.joinedAt || new Date().toISOString(),
      preferences: {
        ambientSoundEnabled: Boolean(data.preferences?.ambientSoundEnabled),
        ambientSoundType: data.preferences?.ambientSoundType || 'none',
        ambientVolume: Number(data.preferences?.ambientVolume ?? 0.4),
        reducedMotion: Boolean(data.preferences?.reducedMotion),
        guardianWellbeingCheckin: Boolean(data.preferences?.guardianWellbeingCheckin),
      },
    };
    setUser(loadedProfile);
    if (typeof data.totalBricksEarned === 'number') {
      setTotalBricksEarned(data.totalBricksEarned);
    }

    // Load Houses (strictly filtered by userId == uid for security rule compliance)
    const housesPath = `users/${uid}/houses`;
    try {
      const housesSnap = await getDocs(
        query(collection(db, 'users', uid, 'houses'), where('userId', '==', uid))
      );
      const allHouses: HouseProject[] = [];
      housesSnap.forEach((d) => {
        const h = d.data();
        allHouses.push({
          id: h.id,
          houseType: h.houseType,
          name: h.name,
          bricksUsed: h.bricksUsed,
          totalBricksRequired: h.totalBricksRequired,
          stage: h.stage,
          percentage: h.percentage,
          startedAt: h.startedAt,
          completedAt: h.completedAt,
          reflectionLog: Array.isArray(h.reflectionLog) ? h.reflectionLog : [],
        });
      });
      allHouses.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
      const completed = allHouses.filter((h) => h.stage === 'completed');
      const active = [...allHouses].reverse().find((h) => h.stage !== 'completed');
      setCompletedHouses(completed);
      if (active) {
        setCurrentHouse(active);
      } else if (completed.length > 0) {
        setCurrentHouse(completed[completed.length - 1]);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, housesPath);
    }

    // Load Messages
    const msgsPath = `users/${uid}/messages`;
    try {
      const msgsSnap = await getDocs(
        query(collection(db, 'users', uid, 'messages'), where('userId', '==', uid))
      );
      const loadedMsgs: ChatMessage[] = [];
      msgsSnap.forEach((d) => {
        const m = d.data();
        loadedMsgs.push({
          id: m.id,
          sender: m.sender,
          text: m.text,
          timestamp: m.timestamp,
          formattedTime: m.formattedTime,
          mode: m.mode,
          reactions: m.reactions,
          brickAwarded: m.brickAwarded,
        });
      });
      loadedMsgs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      if (loadedMsgs.length > 0) {
        setMessages(loadedMsgs);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, msgsPath);
    }

    // Load Moods
    const moodsPath = `users/${uid}/moods`;
    try {
      const moodsSnap = await getDocs(
        query(collection(db, 'users', uid, 'moods'), where('userId', '==', uid))
      );
      const loadedMoods: MoodRecord[] = [];
      moodsSnap.forEach((d) => {
        const mr = d.data();
        loadedMoods.push({
          id: mr.id,
          timestamp: mr.timestamp,
          dateStr: mr.dateStr,
          mood: mr.mood,
          intensity: mr.intensity,
          note: mr.note,
          source: mr.source,
          tags: Array.isArray(mr.tags) ? mr.tags : [],
        });
      });
      loadedMoods.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      setMoodRecords(loadedMoods);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, moodsPath);
    }

    return true;
  }

  // Firebase Auth listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser);
      if (fbUser && fbUser.emailVerified) {
        try {
          const exists = await loadUserWorkspaceFromFirestore(fbUser.uid);
          if (exists) {
            setCurrentRoute((prev) => (prev === 'welcome' ? 'dashboard' : prev));
          }
        } catch (err) {
          console.error('Failed loading Firebase workspace:', err);
        }
      } else {
        firestoreUserReadyRef.current = null;
      }
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // LocalStorage mirror
  useEffect(() => {
    if (user) localStorage.setItem(STORAGE_KEY + '_user', JSON.stringify(user));
  }, [user]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY + '_chat', JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY + '_bricks', totalBricksEarned.toString());
  }, [totalBricksEarned]);

  useEffect(() => {
    if (currentHouse) localStorage.setItem(STORAGE_KEY + '_house', JSON.stringify(currentHouse));
  }, [currentHouse]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY + '_city', JSON.stringify(completedHouses));
  }, [completedHouses]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY + '_moods', JSON.stringify(moodRecords));
  }, [moodRecords]);

  // Firestore write helpers
  async function persistUserDoc(profile: UserProfile, bricksCount: number) {
    const fbUser = auth.currentUser;
    if (!fbUser || !fbUser.emailVerified) return;

    const uid = fbUser.uid;
    const path = `users/${uid}`;
    const payload: Record<string, unknown> = {
      uid,
      fullName: profile.fullName.slice(0, 100),
      email: profile.email.slice(0, 200),
      age: profile.age,
      isMinor: profile.isMinor,
      isEmailVerified: true,
      totalBricksEarned: bricksCount,
      joinedAt: profile.joinedAt,
      updatedAt: new Date().toISOString(),
      preferences: profile.preferences,
    };
    if (profile.guardianEmail) {
      payload.guardianEmail = profile.guardianEmail.slice(0, 200);
    }
    if (typeof profile.guardianConsentGiven === 'boolean') {
      payload.guardianConsentGiven = profile.guardianConsentGiven;
    }

    try {
      await setDoc(doc(db, 'users', uid), payload);
      firestoreUserReadyRef.current = uid;
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  }

  async function persistHouseDoc(house: HouseProject, isNew = false) {
    const fbUser = auth.currentUser;
    if (!fbUser || !fbUser.emailVerified || firestoreUserReadyRef.current !== fbUser.uid) return;

    const uid = fbUser.uid;
    const path = `users/${uid}/houses/${house.id}`;
    try {
      if (isNew) {
        const createPayload: Record<string, unknown> = {
          id: house.id,
          userId: uid,
          houseType: house.houseType,
          name: house.name.slice(0, 120),
          bricksUsed: house.bricksUsed,
          totalBricksRequired: house.totalBricksRequired,
          stage: house.stage,
          percentage: house.percentage,
          startedAt: house.startedAt,
          reflectionLog: house.reflectionLog.slice(-50),
        };
        if (house.completedAt) createPayload.completedAt = house.completedAt;
        await setDoc(doc(db, 'users', uid, 'houses', house.id), createPayload);
      } else {
        const updatePayload: Record<string, unknown> = {
          bricksUsed: house.bricksUsed,
          stage: house.stage,
          percentage: house.percentage,
          reflectionLog: house.reflectionLog.slice(-50),
        };
        if (house.completedAt) updatePayload.completedAt = house.completedAt;
        await updateDoc(doc(db, 'users', uid, 'houses', house.id), updatePayload);
      }
    } catch (err) {
      handleFirestoreError(err, isNew ? OperationType.CREATE : OperationType.UPDATE, path);
    }
  }

  async function persistMessageDoc(msg: ChatMessage) {
    const fbUser = auth.currentUser;
    if (!fbUser || !fbUser.emailVerified || firestoreUserReadyRef.current !== fbUser.uid) return;

    const uid = fbUser.uid;
    const path = `users/${uid}/messages/${msg.id}`;
    const payload: Record<string, unknown> = {
      id: msg.id,
      userId: uid,
      sender: msg.sender,
      text: msg.text.slice(0, 4000),
      timestamp: msg.timestamp,
      formattedTime: msg.formattedTime,
      mode: msg.mode,
    };
    if (msg.reactions && msg.reactions.length > 0) {
      payload.reactions = msg.reactions.slice(0, 10);
    }
    if (msg.brickAwarded) {
      payload.brickAwarded = {
        reason: msg.brickAwarded.reason.slice(0, 400),
        ...(msg.brickAwarded.stageMilestone
          ? { stageMilestone: msg.brickAwarded.stageMilestone.slice(0, 120) }
          : {}),
      };
    }

    try {
      await setDoc(doc(db, 'users', uid, 'messages', msg.id), payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    }
  }

  async function persistMoodDoc(record: MoodRecord) {
    const fbUser = auth.currentUser;
    if (!fbUser || !fbUser.emailVerified || firestoreUserReadyRef.current !== fbUser.uid) return;

    const uid = fbUser.uid;
    const path = `users/${uid}/moods/${record.id}`;
    const payload: Record<string, unknown> = {
      id: record.id,
      userId: uid,
      timestamp: record.timestamp,
      dateStr: record.dateStr,
      mood: record.mood,
      intensity: record.intensity,
      source: record.source,
      tags: record.tags.slice(0, 10),
    };
    if (record.note) {
      payload.note = record.note.slice(0, 1000);
    }

    try {
      await setDoc(doc(db, 'users', uid, 'moods', record.id), payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    }
  }

  // Clean slate reset
  const resetToCleanSlate = () => {
    localStorage.clear();
    const welcomeMsg = createWelcomeMessage();
    setMessages([welcomeMsg]);
    setMoodRecords([]);
    setCompletedHouses([]);
    setTotalBricksEarned(0);
    const now = new Date();
    const freshHouse: HouseProject = {
      id: 'house_' + now.getTime(),
      houseType: 'cozy-cottage',
      name: 'Cozy Cottage of Calm',
      bricksUsed: 0,
      totalBricksRequired: 12,
      stage: 'foundation',
      percentage: 0,
      startedAt: now.toISOString(),
      reflectionLog: [],
    };
    setCurrentHouse(freshHouse);

    const fbUser = auth.currentUser;
    if (fbUser && fbUser.emailVerified && firestoreUserReadyRef.current === fbUser.uid && user) {
      updateDoc(doc(db, 'users', fbUser.uid), {
        totalBricksEarned: 0,
        updatedAt: new Date().toISOString(),
      }).catch(() => {});
    }
  };

  // Navigation handlers
  const navigateTo = (route: AppRoute) => {
    setCurrentRoute(route);
    setNavHistory((prev) => [...prev, route]);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goBack = () => {
    if (navHistory.length > 1) {
      const newStack = [...navHistory];
      newStack.pop();
      const prev = newStack[newStack.length - 1];
      setNavHistory(newStack);
      setCurrentRoute(prev);
    } else {
      setCurrentRoute(user ? 'dashboard' : 'welcome');
    }
  };

  // Real Google Sign-In via Firebase Authentication
  const signInWithGoogle = async (): Promise<GoogleSignInOutcome> => {
    const cred = await signInWithPopup(auth, googleProvider);
    const fbUser = cred.user;
    if (!fbUser.emailVerified) {
      throw new Error('Google account email is not verified.');
    }

    const exists = await loadUserWorkspaceFromFirestore(fbUser.uid);
    if (exists) {
      navigateTo('dashboard');
      return {
        isNewUser: false,
        email: fbUser.email || '',
        displayName: fbUser.displayName || 'Traveler',
        uid: fbUser.uid,
      };
    }

    return {
      isNewUser: true,
      email: fbUser.email || '',
      displayName: fbUser.displayName || '',
      uid: fbUser.uid,
    };
  };

  // Auth & Profile
  const registerUser = async (profile: Partial<UserProfile>) => {
    const fbUser = auth.currentUser;
    const uid = fbUser?.uid || 'user_' + Date.now();
    const fullProfile: UserProfile = {
      id: uid,
      fullName: profile.fullName || fbUser?.displayName || 'Traveler',
      email: profile.email || fbUser?.email || '',
      age: profile.age || 21,
      isMinor: (profile.age || 21) < 18,
      guardianEmail: profile.guardianEmail,
      guardianConsentGiven: profile.guardianConsentGiven || false,
      isEmailVerified: true,
      joinedAt: new Date().toISOString(),
      preferences: {
        ambientSoundEnabled: false,
        ambientSoundType: 'none',
        ambientVolume: 0.4,
        reducedMotion: false,
        guardianWellbeingCheckin: false,
        ...profile.preferences,
      },
    };
    setUser(fullProfile);

    if (fbUser && fbUser.emailVerified) {
      await persistUserDoc(fullProfile, totalBricksEarned);
      if (currentHouse) {
        await persistHouseDoc(currentHouse, true);
      }
    }

    navigateTo('choose-house');
  };

  const updateUserPreferences = (prefs: Partial<UserProfile['preferences']>) => {
    if (!user) return;
    const updatedUser: UserProfile = {
      ...user,
      preferences: {
        ...user.preferences,
        ...prefs,
      },
    };
    setUser(updatedUser);

    const fbUser = auth.currentUser;
    if (fbUser && fbUser.emailVerified && firestoreUserReadyRef.current === fbUser.uid) {
      updateDoc(doc(db, 'users', fbUser.uid), {
        preferences: updatedUser.preferences,
        updatedAt: new Date().toISOString(),
      }).catch((err) => handleFirestoreError(err, OperationType.UPDATE, `users/${fbUser.uid}`));
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch {
      // ignore if not signed into Firebase
    }
    firestoreUserReadyRef.current = null;
    setUser(null);
    localStorage.removeItem(STORAGE_KEY + '_user');
    navigateTo('welcome');
  };

  // Audio Controls
  const setAmbientType = (type: 'cafe' | 'rain' | 'forest' | 'chimes' | 'none') => {
    setAmbientTypeState(type);
    if (type === 'none') {
      soundEngine.stopAmbient();
    } else {
      soundEngine.playAmbient(type);
    }
  };

  const setAmbientVolume = (vol: number) => {
    setAmbientVolumeState(vol);
    soundEngine.setVolume(vol);
  };

  const toggleSpotifyConnect = () => {
    setIsSpotifyConnected((prev) => !prev);
  };

  // Mode switching
  const setCompanionMode = (mode: CompanionMode) => {
    setCompanionModeState(mode);
    const modeNames = {
      friend: 'Friend Mode (Fairytale Café & Banter)',
      soulmate: 'Soulmate Mode (Starlight Twilight & Tender Comfort)',
      guide: 'Guide Mode (Study Castle & Socratic Clarity)',
    };
    const now = new Date();
    const shiftMsg: ChatMessage = {
      id: 'mode_shift_' + Date.now(),
      sender: 'spashta',
      text: `✨ Switched to ${modeNames[mode]}. I'm right here with you.`,
      timestamp: now.toISOString(),
      formattedTime: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      mode,
    };
    setMessages((prev) => [...prev, shiftMsg]);
    persistMessageDoc(shiftMsg).catch(() => {});
  };

  // House selection
  const selectHouseForConstruction = (houseType: HouseType, name: string) => {
    const newProject: HouseProject = {
      id: 'house_' + Date.now(),
      houseType,
      name,
      bricksUsed: 0,
      totalBricksRequired: 12,
      stage: 'foundation',
      percentage: 0,
      startedAt: new Date().toISOString(),
      reflectionLog: [],
    };
    setCurrentHouse(newProject);
    persistHouseDoc(newProject, true).catch(() => {});
    navigateTo('dashboard');
  };

  // Clarity brick addition logic
  const awardClarityBrick = (reason: string) => {
    const nextTotal = totalBricksEarned + 1;
    setTotalBricksEarned(nextTotal);
    playBrickEarnedSound();
    setActiveBrickCelebration({ reason });

    const fbUser = auth.currentUser;
    if (fbUser && fbUser.emailVerified && firestoreUserReadyRef.current === fbUser.uid) {
      updateDoc(doc(db, 'users', fbUser.uid), {
        totalBricksEarned: nextTotal,
        updatedAt: new Date().toISOString(),
      }).catch((err) => handleFirestoreError(err, OperationType.UPDATE, `users/${fbUser.uid}`));
    }

    if (currentHouse && currentHouse.stage !== 'completed') {
      const newBricksUsed = currentHouse.bricksUsed + 1;
      const totalReq = currentHouse.totalBricksRequired || 12;
      const newPercentage = Math.min(100, Math.round((newBricksUsed / totalReq) * 100));

      const stageIndex = Math.min(
        STAGE_ORDER.length - 1,
        Math.floor((newBricksUsed / totalReq) * (STAGE_ORDER.length - 1))
      );
      const newStage = STAGE_ORDER[stageIndex];
      const isNowCompleted = newBricksUsed >= totalReq;

      const updatedHouse: HouseProject = {
        ...currentHouse,
        bricksUsed: newBricksUsed,
        percentage: newPercentage,
        stage: isNowCompleted ? 'completed' : newStage,
        completedAt: isNowCompleted ? new Date().toISOString() : undefined,
        reflectionLog: [...currentHouse.reflectionLog, reason].slice(-50),
      };

      setCurrentHouse(updatedHouse);
      persistHouseDoc(updatedHouse, false).catch(() => {});

      if (isNowCompleted) {
        confetti({
          particleCount: 160,
          spread: 100,
          origin: { y: 0.6 },
          colors: ['#FDE047', '#E9D5FF', '#A5F3FC', '#F472B6', '#FBBF24'],
        });
        setCompletedHouses((prev) => [...prev, updatedHouse]);
      }
    }
  };

  const clearBrickCelebration = () => {
    setActiveBrickCelebration(null);
  };

  // Chat message sending
  const sendMessage = async (text: string) => {
    if (!text.trim()) return;

    const now = new Date();
    const userMsg: ChatMessage = {
      id: 'usr_' + Date.now(),
      sender: 'user',
      text: text.trim(),
      timestamp: now.toISOString(),
      formattedTime: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      mode: companionMode,
    };

    setMessages((prev) => [...prev, userMsg]);
    persistMessageDoc(userMsg).catch(() => {});
    setIsAiTyping(true);

    try {
      const historyPayload = messages.slice(-6).map((m) => ({
        role: m.sender === 'user' ? ('user' as const) : ('model' as const),
        parts: m.text,
      }));

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text.trim(),
          history: historyPayload,
          mode: companionMode,
          userName: user?.fullName || 'friend',
          isMinor: !!user?.isMinor,
          houseName: currentHouse?.name || 'Dream Sanctuary',
          houseStage: currentHouse?.stage || 'foundation',
          totalBricksEarned,
        }),
      });

      const data = await res.json();
      setIsAiTyping(false);

      const replyTime = new Date();
      const botMsg: ChatMessage = {
        id: 'bot_' + Date.now(),
        sender: 'spashta',
        text: data.reply || "I'm right here with you. Tell me what's on your mind.",
        timestamp: replyTime.toISOString(),
        formattedTime: replyTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        mode: companionMode,
        brickAwarded: data.earnedBrick
          ? { reason: data.brickReason || 'You found a moment of genuine clarity!' }
          : undefined,
      };

      setMessages((prev) => [...prev, botMsg]);
      persistMessageDoc(botMsg).catch(() => {});

      if (data.earnedBrick) {
        awardClarityBrick(data.brickReason || 'Earned through thoughtful reflection.');
      }

      if (data.detectedMood) {
        addMoodRecord(data.detectedMood as MoodType, 3, `Reflected in ${companionMode} mode`, ['chat_reflection']);
      }

      if (data.wellbeingConcern) {
        setWellbeingPrompt({
          id: 'wellbeing_' + Date.now(),
          triggeredAt: new Date().toISOString(),
          reason: 'I noticed things felt a little heavy just now. Just checking in on you gently.',
          status: 'pending',
        });
      }
    } catch {
      setIsAiTyping(false);
      const fallbackTime = new Date();
      const errMsg: ChatMessage = {
        id: 'bot_err_' + Date.now(),
        sender: 'spashta',
        text: "I'm right here with you. Take a soft breath. Let's take it one thought at a time. ✨",
        timestamp: fallbackTime.toISOString(),
        formattedTime: fallbackTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        mode: companionMode,
      };
      setMessages((prev) => [...prev, errMsg]);
    }
  };

  const clearChat = () => {
    setMessages([]);
    const fbUser = auth.currentUser;
    if (fbUser && fbUser.emailVerified && firestoreUserReadyRef.current === fbUser.uid) {
      getDocs(query(collection(db, 'users', fbUser.uid, 'messages'), where('userId', '==', fbUser.uid)))
        .then((snap) => {
          if (snap.empty) return;
          const batch = writeBatch(db);
          snap.forEach((d) => batch.delete(d.ref));
          return batch.commit();
        })
        .catch(() => {});
    }
  };

  // Mood Records
  const addMoodRecord = (mood: MoodType, intensity: number, note?: string, tags: string[] = []) => {
    const newRecord: MoodRecord = {
      id: 'mood_' + Date.now(),
      timestamp: new Date().toISOString(),
      dateStr: new Date().toISOString().slice(0, 10),
      mood,
      intensity,
      note,
      source: tags.includes('chat_reflection') ? 'chat_reflection' : 'self_checkin',
      tags,
    };
    setMoodRecords((prev) => [...prev, newRecord]);
    persistMoodDoc(newRecord).catch(() => {});

    const recentNegative = moodRecords
      .slice(-4)
      .filter((m) => m.mood === 'overwhelmed' || m.mood === 'anxious' || m.mood === 'tired');
    if (recentNegative.length >= 3 && !wellbeingPrompt) {
      setWellbeingPrompt({
        id: 'wellbeing_pattern_' + Date.now(),
        triggeredAt: new Date().toISOString(),
        reason: "You've been navigating some heavy waves recently. Would you like to pause and check in?",
        status: 'pending',
      });
    }
  };

  const handleWellbeingResponse = (response: 'im_okay' | 'need_talk' | 'take_break' | 'remind_later') => {
    if (wellbeingPrompt) {
      setWellbeingPrompt({
        ...wellbeingPrompt,
        status: 'responded',
        response,
      });

      if (response === 'need_talk') {
        navigateTo('chat');
        const msg: ChatMessage = {
          id: 'wellbeing_followup_' + Date.now(),
          sender: 'spashta',
          text: "I'm right here. Take all the time you need. What's sitting most heavily on your shoulders today?",
          timestamp: new Date().toISOString(),
          formattedTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          mode: 'soulmate',
        };
        setMessages((prev) => [...prev, msg]);
        persistMessageDoc(msg).catch(() => {});
      } else if (response === 'take_break') {
        setAmbientType('chimes');
      }

      setTimeout(() => setWellbeingPrompt(null), 2500);
    }
  };

  const dismissWellbeingPrompt = () => {
    setWellbeingPrompt(null);
  };

  return (
    <AppContext.Provider
      value={{
        currentRoute,
        navigateTo,
        goBack,
        navigationHistory: navHistory,
        user,
        firebaseUser,
        isAuthReady,
        signInWithGoogle,
        registerUser,
        updateUserPreferences,
        logout,
        resetToCleanSlate,
        companionMode,
        setCompanionMode,
        messages,
        sendMessage,
        clearChat,
        isAiTyping,
        activeBrickCelebration,
        clearBrickCelebration,
        currentHouse,
        completedHouses,
        selectHouseForConstruction,
        totalBricksEarned,
        bricksUsedInCurrentHouse: currentHouse?.bricksUsed || 0,
        moodRecords,
        addMoodRecord,
        wellbeingPrompt,
        handleWellbeingResponse,
        dismissWellbeingPrompt,
        ambientType,
        setAmbientType,
        ambientVolume,
        setAmbientVolume,
        isSpotifyConnected,
        toggleSpotifyConnect,
        spotifyUri,
        setSpotifyUri,
        achievements,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
