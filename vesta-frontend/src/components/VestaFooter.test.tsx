import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import VestaFooter from "./VestaFooter";

describe("VestaFooter", () => {
  it("shows strict support-only policy language", () => {
    render(<VestaFooter />);

    expect(screen.getByText(/internal workflow support only/i)).toBeInTheDocument();
    expect(
      screen.getByText(/must be reviewed by qualified professionals/i),
    ).toBeInTheDocument();
  });
});
