import type { Line, Notice } from "@/lib/notify/notice";
import { formatTime } from "@/lib/calls";

export type TodaysCall = { project: string; client: string; time: string; duration_min: number | null; link: string | null };

/** The morning list of today's client calls for one manager. */
export function callsNotice(date: string, calls: TodaysCall[]): Notice {
  const lines: Line[] = calls.map((c) => ({
    text: `${formatTime(c.time)} (IST): ${c.client}, ${c.project}${c.duration_min ? `, ${c.duration_min} min` : ""}${c.link ? ` - ${c.link}` : ""}`,
  }));
  return {
    title: `Client calls today (${date})`,
    sections: [],
    letter: [[{ text: calls.length === 1 ? "You have a client call today." : `You have ${calls.length} client calls today.` }], lines],
  };
}
