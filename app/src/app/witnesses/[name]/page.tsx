import type { Metadata } from 'next';
import WitnessDetailClient from './WitnessDetailClient';

interface PageProps {
  params: Promise<{ name: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { name } = await params;
  const witnessName = decodeURIComponent(name);
  
  return {
    title: witnessName,
    description: `Read the testimony of ${witnessName} from the Eichmann Trial in Jerusalem, 1961. Full trial transcript and historical context.`,
    openGraph: {
      title: `${witnessName} | The Eichmann Trial`,
      description: `Testimony of ${witnessName} at the Eichmann Trial, Jerusalem 1961.`,
    },
    keywords: [witnessName, "Eichmann Trial", "Holocaust Testimony", "Witness Testimony", "Jerusalem 1961"],
  };
}

export default function WitnessDetailPage() {
  return <WitnessDetailClient />;
}
