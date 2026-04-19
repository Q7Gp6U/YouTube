// @vitest-environment jsdom

import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { UrlInputForm } from "@/components/url-input-form"

describe("UrlInputForm", () => {
  it("submits a trimmed URL once", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)

    render(<UrlInputForm onSubmit={onSubmit} />)

    await user.type(screen.getByPlaceholderText("Вставьте ссылку на YouTube-видео..."), "  https://youtu.be/dQw4w9WgXcQ  ")
    await user.click(screen.getByRole("button", { name: /получить суть/i }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith("https://youtu.be/dQw4w9WgXcQ")
  })

  it("disables submission when credits are unavailable", () => {
    render(<UrlInputForm onSubmit={vi.fn()} isDisabled />)

    expect(screen.getByPlaceholderText("Сначала пополните баланс кредитов...")).toBeDisabled()
    expect(screen.getByRole("button", { name: /нет кредитов/i })).toBeDisabled()
  })
})
