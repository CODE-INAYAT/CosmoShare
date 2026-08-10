import { useState, useEffect, useCallback } from 'react';
import { 
  SMART_PREFILL_STUDENT_MOBILE, 
  SMART_PREFILL_STUDENT_DESKTOP, 
  SMART_PREFILL_ADMIN_DESKTOP 
} from '../config/smartPrefill';

// Types
export interface MobileHistoryEntry {
  dayOfWeek: number; // 0-6 (Sun-Sat)
  timeInMinutes: number; // 0-1439
  room: string;
  lastUsed: number; // timestamp
}

export interface DesktopHistory {
  sequence: string[]; // up to 3 items
  established: string | null;
}

export function useSmartPrefill() {
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    setIsLoaded(true);
  }, []);

  const getPrefilledName = useCallback(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem('SMART_PREFILL_NAME') || '';
  }, []);

  const recordName = useCallback((name: string) => {
    if (typeof window === 'undefined' || !name) return;
    localStorage.setItem('SMART_PREFILL_NAME', name.trim().toUpperCase());
  }, []);

  // --- Mobile Student Logic ---
  const getMobilePrefill = useCallback((): string => {
    if (typeof window === 'undefined' || !SMART_PREFILL_STUDENT_MOBILE) return '';
    const stored = localStorage.getItem('SMART_PREFILL_MOBILE_HISTORY');
    if (!stored) return '';

    try {
      const history: MobileHistoryEntry[] = JSON.parse(stored);
      if (!Array.isArray(history) || history.length === 0) return '';

      const now = new Date();
      const currentDay = now.getDay();
      const currentMinutes = now.getHours() * 60 + now.getMinutes();

      // Filter to today's patterns and sort by time
      const todayPatterns = history
        .filter(entry => entry.dayOfWeek === currentDay)
        .sort((a, b) => a.timeInMinutes - b.timeInMinutes);

      if (todayPatterns.length === 0) return '';

      // Find the applicable pattern. Window starts 30 mins before the pattern time.
      let selectedRoom = '';
      
      // If current time is before the first pattern's window, do not prefill (or default)
      if (currentMinutes < todayPatterns[0].timeInMinutes - 30) {
        return '';
      }

      for (let i = 0; i < todayPatterns.length; i++) {
        const pattern = todayPatterns[i];
        const nextPattern = todayPatterns[i + 1];
        
        const windowStart = pattern.timeInMinutes - 30;
        const windowEnd = nextPattern ? nextPattern.timeInMinutes - 30 : 1440; // end of day if last

        if (currentMinutes >= windowStart && currentMinutes < windowEnd) {
          selectedRoom = pattern.room;
          break;
        }
      }

      return selectedRoom;
    } catch (e) {
      console.error('Error parsing mobile prefill history', e);
      return '';
    }
  }, []);

  const recordMobileJoin = useCallback((room: string) => {
    if (typeof window === 'undefined' || !SMART_PREFILL_STUDENT_MOBILE || !room) return;
    const stored = localStorage.getItem('SMART_PREFILL_MOBILE_HISTORY');
    let history: MobileHistoryEntry[] = [];
    try {
      if (stored) history = JSON.parse(stored);
      if (!Array.isArray(history)) history = [];
    } catch (e) {
      history = [];
    }

    const now = new Date();
    const currentDay = now.getDay();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    // Find if there is an existing pattern within +/- 60 mins on the same day
    const existingIndex = history.findIndex(entry => 
      entry.dayOfWeek === currentDay && 
      Math.abs(entry.timeInMinutes - currentMinutes) <= 60
    );

    if (existingIndex >= 0) {
      // Update existing pattern
      history[existingIndex].room = room;
      history[existingIndex].timeInMinutes = currentMinutes; // Update time to match latest behavior
      history[existingIndex].lastUsed = now.getTime();
    } else {
      // Add new pattern
      history.push({
        dayOfWeek: currentDay,
        timeInMinutes: currentMinutes,
        room: room,
        lastUsed: now.getTime()
      });
    }

    // Keep history reasonably sized, e.g., max 50 entries
    if (history.length > 50) {
      history.sort((a, b) => b.lastUsed - a.lastUsed);
      history = history.slice(0, 50);
    }

    localStorage.setItem('SMART_PREFILL_MOBILE_HISTORY', JSON.stringify(history));
  }, []);

  // --- Desktop Logic (Student & Admin) ---
  const getDesktopPrefill = useCallback((isAdmin: boolean): string => {
    if (typeof window === 'undefined') return '';
    if (isAdmin && !SMART_PREFILL_ADMIN_DESKTOP) return '';
    if (!isAdmin && !SMART_PREFILL_STUDENT_DESKTOP) return '';

    const key = isAdmin ? 'SMART_PREFILL_DESKTOP_ADMIN_HISTORY' : 'SMART_PREFILL_DESKTOP_STUDENT_HISTORY';
    const stored = localStorage.getItem(key);
    if (!stored) return '';

    try {
      const data: DesktopHistory = JSON.parse(stored);
      return data.established || '';
    } catch (e) {
      return '';
    }
  }, []);

  const recordDesktopJoin = useCallback((room: string, isAdmin: boolean) => {
    if (typeof window === 'undefined' || !room) return;
    if (isAdmin && !SMART_PREFILL_ADMIN_DESKTOP) return;
    if (!isAdmin && !SMART_PREFILL_STUDENT_DESKTOP) return;

    const key = isAdmin ? 'SMART_PREFILL_DESKTOP_ADMIN_HISTORY' : 'SMART_PREFILL_DESKTOP_STUDENT_HISTORY';
    const stored = localStorage.getItem(key);
    let data: DesktopHistory = { sequence: [], established: null };
    try {
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed.sequence)) {
          data = parsed;
        }
      }
    } catch (e) {
      // Keep default
    }

    data.sequence.push(room);
    if (data.sequence.length > 3) {
      data.sequence.shift(); // Keep only last 3
    }

    // Check if last 3 are identical
    if (data.sequence.length === 3 && data.sequence[0] === data.sequence[1] && data.sequence[1] === data.sequence[2]) {
      data.established = data.sequence[0];
    }

    localStorage.setItem(key, JSON.stringify(data));
  }, []);

  // --- Facades ---
  const getPrefilledRoom = useCallback((isMobile: boolean, userType: 'student' | 'admin'): string => {
    if (userType === 'student' && isMobile) {
      return getMobilePrefill();
    } else {
      return getDesktopPrefill(userType === 'admin');
    }
  }, [getMobilePrefill, getDesktopPrefill]);

  const recordJoin = useCallback((room: string, isMobile: boolean, userType: 'student' | 'admin') => {
    if (userType === 'student' && isMobile) {
      recordMobileJoin(room);
    } else {
      recordDesktopJoin(room, userType === 'admin');
    }
  }, [recordMobileJoin, recordDesktopJoin]);

  return {
    isLoaded,
    getPrefilledRoom,
    getPrefilledName,
    recordJoin,
    recordName
  };
}
