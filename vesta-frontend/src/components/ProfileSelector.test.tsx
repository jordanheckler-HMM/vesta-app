import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ProfileSelector from "./ProfileSelector";

describe("ProfileSelector", () => {
  it("calls onProfileChange with the selected profile", () => {
    const onProfileChange = vi.fn();

    render(
      <ProfileSelector
        selectedProfile="default"
        onProfileChange={onProfileChange}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: /medical/i }));

    expect(onProfileChange).toHaveBeenCalledWith("medical");
  });
});
