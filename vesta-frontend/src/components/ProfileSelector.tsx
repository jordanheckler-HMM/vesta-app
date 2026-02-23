import { Stethoscope, Scale, UserRound } from "lucide-react";

export type AssistantProfile = "default" | "medical" | "legal";

interface ProfileSelectorProps {
  selectedProfile: AssistantProfile;
  onProfileChange: (profile: AssistantProfile) => void;
  compact?: boolean;
  inline?: boolean;
}

const profiles: {
  id: AssistantProfile;
  label: string;
  shortLabel: string;
  icon: React.ReactNode;
}[] = [
  {
    id: "default",
    label: "Default",
    shortLabel: "Default",
    icon: <UserRound className="w-4 h-4" />,
  },
  {
    id: "medical",
    label: "Medical",
    shortLabel: "Medical",
    icon: <Stethoscope className="w-4 h-4" />,
  },
  {
    id: "legal",
    label: "Legal",
    shortLabel: "Legal",
    icon: <Scale className="w-4 h-4" />,
  },
];

const ProfileSelector = ({
  selectedProfile,
  onProfileChange,
  compact = false,
  inline = false,
}: ProfileSelectorProps) => {
  if (inline) {
    return (
      <div className="flex items-center gap-2">
        <p className="text-[11px] font-medium text-muted-foreground whitespace-nowrap">
          Profile
        </p>
        <div
          className="flex flex-wrap gap-1.5"
          role="radiogroup"
          aria-label="Assistant profile"
        >
          {profiles.map((profile) => (
            <button
              key={profile.id}
              type="button"
              role="radio"
              aria-checked={selectedProfile === profile.id}
              onClick={() => onProfileChange(profile.id)}
              className={`px-2.5 py-1 text-[11px] rounded-md border transition-colors ${
                selectedProfile === profile.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background hover:bg-muted text-muted-foreground"
              }`}
            >
              {profile.shortLabel}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="border-b border-vesta-header-border bg-card">
      <div className={`max-w-4xl mx-auto px-6 ${compact ? "py-2.5" : "py-3.5"}`}>
        <p
          className={`font-medium text-muted-foreground ${
            compact ? "text-[11px] mb-1.5" : "text-xs mb-2"
          }`}
        >
          Assistant Profile
        </p>
        <div
          className={`grid gap-2 ${compact ? "grid-cols-3" : "grid-cols-3"}`}
          role="radiogroup"
          aria-label="Assistant profile"
        >
          {profiles.map((profile) => (
            <button
              key={profile.id}
              type="button"
              role="radio"
              aria-checked={selectedProfile === profile.id}
              onClick={() => onProfileChange(profile.id)}
              className={`flex items-center justify-center gap-1.5 ${
                compact ? "px-2 py-1.5 text-[11px]" : "px-3 py-2 text-xs"
              } rounded-md border transition-colors ${
                selectedProfile === profile.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background hover:bg-muted text-muted-foreground"
              }`}
            >
              <span>{profile.icon}</span>
              <span className="font-medium">{profile.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ProfileSelector;
