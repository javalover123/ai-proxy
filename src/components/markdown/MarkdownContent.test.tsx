import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownContent } from "./MarkdownContent";
import { parseGfmWithMath } from "./parse";

// MarkdownContent 依赖 Tauri invoke 与 i18next，测试中分别 mock
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve()) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));
vi.mock("./parse", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./parse")>();
  return {
    ...actual,
    parseGfmWithMath: vi.fn((text: string) => actual.parseGfmWithMath(text)),
  };
});

import { invoke } from "@tauri-apps/api/core";

const mockedInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

describe("MarkdownContent 集成", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    const actual = await vi.importActual<typeof import("./parse")>("./parse");
    vi.mocked(parseGfmWithMath).mockImplementation((text: string) => actual.parseGfmWithMath(text));
  });

  it("普通文本渲染为段落", () => {
    render(<MarkdownContent text="你好，世界" />);
    expect(screen.getByText("你好，世界")).toBeInTheDocument();
  });

  it("点击 http 链接先弹出确认弹窗，确认后才调用 open_url", async () => {
    render(<MarkdownContent text="[链接](https://example.com/path)" />);
    const link = screen.getByRole("link", { name: "链接" });
    fireEvent.click(link);

    // 弹窗出现，且尚未调用 invoke
    expect(screen.getByText("打开外部链接？")).toBeInTheDocument();
    expect(screen.getByText("https://example.com/path")).toBeInTheDocument();
    expect(mockedInvoke).not.toHaveBeenCalled();

    // 确认后调用 open_url
    fireEvent.click(screen.getByText("打开链接"));
    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("open_url", { url: "https://example.com/path" });
    });
  });

  it("取消确认不打开链接", () => {
    render(<MarkdownContent text="[链接](https://example.com/path)" />);
    fireEvent.click(screen.getByRole("link", { name: "链接" }));
    fireEvent.click(screen.getByText("取消"));
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("危险协议链接降级为文字，点击不弹窗", () => {
    render(<MarkdownContent text="[x](javascript:alert(1))" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("inverted 变体携带 md-inverted class", () => {
    const { container } = render(<MarkdownContent text="内容" variant="inverted" />);
    expect(container.querySelector(".md-inverted")).not.toBeNull();
  });

  it("中键点击链接同样弹出确认，且不调用 open_url", () => {
    render(<MarkdownContent text="[链接](https://example.com/path)" />);
    fireEvent(
      screen.getByRole("link", { name: "链接" }),
      new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }),
    );
    expect(screen.getByText("打开外部链接？")).toBeInTheDocument();
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("右键链接不打开系统菜单式导航，改为弹出确认", () => {
    render(<MarkdownContent text="[链接](https://example.com/path)" />);
    fireEvent.contextMenu(screen.getByRole("link", { name: "链接" }));
    expect(screen.getByText("打开外部链接？")).toBeInTheDocument();
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("open_url 失败时保持弹窗并显示错误", async () => {
    mockedInvoke.mockRejectedValueOnce(new Error("failed"));
    render(<MarkdownContent text="[链接](https://example.com/path)" />);
    fireEvent.click(screen.getByRole("link", { name: "链接" }));
    fireEvent.click(screen.getByText("打开链接"));
    expect(await screen.findByText("无法打开链接")).toBeInTheDocument();
    expect(screen.getByText("https://example.com/path")).toBeInTheDocument();
  });

  it("渲染抛错后源文变化会重新尝试渲染", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const actual = await vi.importActual<typeof import("./parse")>("./parse");
    vi.mocked(parseGfmWithMath).mockImplementation((text: string) => {
      if (text.includes("**world**")) throw new Error("boom");
      return actual.parseGfmWithMath(text);
    });
    const { rerender } = render(<MarkdownContent text="hello **world**" />);
    expect(screen.getByText(/hello \*\*world\*\*/)).toBeInTheDocument();
    expect(screen.queryByText("world", { selector: "strong" })).not.toBeInTheDocument();

    rerender(<MarkdownContent text="ok **bold**" />);
    expect(screen.getByText("bold")).toBeInTheDocument();
    consoleSpy.mockRestore();
  });
});
