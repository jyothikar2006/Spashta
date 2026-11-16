export type AppRoute = 
  | 'welcome'
  | 'choose-house'
  | 'dashboard'
  | 'chat'
  | 'construction'
  | 'my-city'
  | 'mood-history'
  | 'profile-settings';

export type CompanionMode = 'friend' | 'soulmate' | 'guide';

export interface UserProfile {
  id: string;
  fullName: string;
  email: string;
  age: number;
  isMinor: boolean;
  guardianEmail?: string;
  guardianConsentGiven?: boolean;
  isEmailVerified: boolean;
  joinedAt: string;
  preferences: {
    ambientSoundEnabled: boolean;
    ambientSoundType: 'cafe' | 'rain' | 'forest' | 'chimes' | 'none';
    ambientVolume: number;
    reducedMotion: boolean;
    guardianWellbeingCheckin: boolean;
  };
}

export type HouseType = 
  | 'cozy-cottage'
  | 'modern-glass'
  | 'treehouse'
  | 'castle'
  | 'beach-house'
  | 'mountain-cabin'
  | 'contemporary-villa';

export interface HouseDefinition {
  id: HouseType;
  name: string;
  subtitle: string;
  description: string;
  themeColor: string;
  bricksRequired: number; // typically 10-14 bricks per house
}

export type ConstructionStage = 
  | 'foundation'
  | 'walls'
  | 'windows-doors'
  | 'roof'
  | 'interior'
  | 'landscaping'
  | 'completed';

export interface HouseProject {
  id: string;
  houseType: HouseType;
  name: string;
  bricksUsed: number;
  totalBricksRequired: number;
  stage: ConstructionStage;
  percentage: number;
  completedAt?: string;
  startedAt: string;
  reflectionLog: string[];
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'spashta';
  text: string;
  timestamp: string; // ISO string
  formattedTime: string; // e.g. "6:42 PM"
  mode: CompanionMode;
  reactions?: string[];
  brickAwarded?: {
    reason: string;
    stageMilestone?: string;
  };
}

export type MoodType = 
  | 'joyful'
  | 'peaceful'
  | 'reflective'
  | 'overwhelmed'
  | 'anxious'
  | 'hopeful'
  | 'tired'
  | 'clarified';

export interface MoodRecord {
  id: string;
  timestamp: string; // ISO string
  dateStr: string; // YYYY-MM-DD
  mood: MoodType;
  intensity: number; // 1-5
  note?: string;
  source: 'self_checkin' | 'chat_reflection';
  tags: string[];
}

export interface CityAchievement {
  id: string;
  title: string;
  description: string;
  iconName: string;
  unlockedAt: string;
}

export interface WellbeingCheckinPrompt {
  id: string;
  triggeredAt: string;
  reason: string;
  status: 'pending' | 'dismissed' | 'responded';
  response?: 'im_okay' | 'need_talk' | 'take_break' | 'remind_later';
}
