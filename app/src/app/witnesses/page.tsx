import type { Metadata } from 'next';
import WitnessesClient from './WitnessesClient';

export const metadata: Metadata = {
  title: "Witnesses",
  description: "Meet the 110+ witnesses who testified at the Eichmann Trial in Jerusalem, 1961. Explore their testimonies and stories.",
  openGraph: {
    title: "Witnesses | The Eichmann Trial",
    description: "Meet the 110+ witnesses who testified at the Eichmann Trial in Jerusalem, 1961.",
  },
  keywords: ["Eichmann Trial Witnesses", "Holocaust Survivors", "Trial Testimony", "Jerusalem 1961"],
};

export default function WitnessesPage() {
  return <WitnessesClient />;
}
