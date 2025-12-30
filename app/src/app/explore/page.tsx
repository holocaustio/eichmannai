import type { Metadata } from 'next';
import ExploreClient from './ExploreClient';

export const metadata: Metadata = {
  title: "Explore",
  description: "Explore entities, connections, and the timeline of the Eichmann Trial. Navigate people, places, organizations, and events from the 1961 proceedings.",
  openGraph: {
    title: "Explore | The Eichmann Trial",
    description: "Explore entities, connections, and the timeline of the Eichmann Trial.",
  },
  keywords: ["Eichmann Trial Timeline", "Trial Entities", "Holocaust History", "Jerusalem 1961", "Trial Sessions"],
};

export default function ExplorePage() {
  return <ExploreClient />;
}
