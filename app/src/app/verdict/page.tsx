import type { Metadata } from 'next';
import VerdictClient from './VerdictClient';

export const metadata: Metadata = {
  title: "The Verdict",
  description: "The judgment rendered by the District Court of Jerusalem in December 1961. Adolf Eichmann was found guilty on all counts.",
  openGraph: {
    title: "The Verdict | The Eichmann Trial",
    description: "The judgment rendered by the District Court of Jerusalem, December 1961.",
  },
  keywords: ["Eichmann Verdict", "Trial Judgment", "Jerusalem Court", "Holocaust Justice"],
};

export default function VerdictPage() {
  return <VerdictClient />;
}
