"use client"

import * as React from "react"
import { cn } from "cn"
import { CheckIcon, ChevronDownIcon, SearchIcon } from "lucide-react"
import {
  Button as ButtonPrimitive,
  composeRenderProps,
  Header as HeaderPrimitive,
  Input as InputPrimitive,
  ListBoxItem as ListBoxItemPrimitive,
  ListBox as ListBoxPrimitive,
  ListBoxSection as ListBoxSectionPrimitive,
  Popover as PopoverPrimitive,
  SearchField,
  Select as SelectPrimitive,
  SelectValue as SelectValuePrimitive,
  Separator as SeparatorPrimitive,
  type ListBoxProps,
  type SearchFieldProps,
  type ListBoxSectionProps as SelectGroupProps,
  type SelectProps,
  type SelectValueProps,
} from "react-aria-components"

// Callit theme tokens. `app/globals.css` declares no shadcn design tokens
// (--color-popover, --color-accent, --color-input, --color-ring, --radius, …),
// so every shadcn class these parts shipped with compiled to nothing. The
// widgets below are themed directly in Callit cream/ink — the same values the
// worksheet fields use — rather than depending on an absent token layer.
const FIELD =
  "rounded-xl bg-[#2D1C00]/5 ring-1 ring-[#2D1C00]/10 text-sm font-medium tracking-tight text-[#2D1C00]"

function Select<T extends object, M extends "single" | "multiple" = "single">({
  className,
  ...props
}: SelectProps<T, M>) {
  return (
    <SelectPrimitive
      data-slot="select"
      className={cn("w-fit", className)}
      {...props}
    />
  )
}

function SelectGroup<T extends object>({
  className,
  ...props
}: SelectGroupProps<T>) {
  return (
    <ListBoxSectionPrimitive
      data-slot="select-group"
      className={cn("scroll-my-1 p-1", className)}
      {...props}
    />
  )
}

function SelectValue<T extends object>({
  className,
  children,
  ...props
}: SelectValueProps<T>) {
  return (
    <SelectValuePrimitive
      data-slot="select-value"
      className={cn(
        "flex flex-1 text-left data-placeholder:text-[#2D1C00]/35",
        className
      )}
      {...props}
    >
      {typeof children === "function"
        ? children
        : ({ selectedItems, selectedText, defaultChildren }) =>
            selectedItems.length > 1 ? selectedText : defaultChildren}
    </SelectValuePrimitive>
  )
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: Omit<React.ComponentProps<typeof ButtonPrimitive>, "children"> & {
  children?: React.ReactNode
  size?: "sm" | "default"
}) {
  return (
    <ButtonPrimitive
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        // Phase 4: shaped to match the worksheet `inputClass` field, so the
        // swapped control is visually indistinguishable from a text input.
        // Focus is a Callit ink ring, not the (undefined) shadcn --ring.
        `flex w-full cursor-pointer items-center justify-between gap-2 px-4 py-3 outline-none transition select-none focus-visible:ring-2 focus-visible:ring-[#2D1C00]/30 disabled:cursor-not-allowed disabled:opacity-50 data-placeholder:text-[#2D1C00]/35 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4`,
        FIELD,
        className
      )}
      {...props}
    >
      {children}
      <ChevronDownIcon className="pointer-events-none size-4 text-[#2D1C00]/45" />
    </ButtonPrimitive>
  )
}

function SelectContent({
  className,
  children,
  placement = "bottom",
  offset = 4,
  crossOffset = 0,
  ...props
}: Omit<
  React.ComponentProps<typeof PopoverPrimitive>,
  "className" | "children"
> & {
  className?: string
  children?: React.ReactNode
}) {
  return (
    <SelectPopover
      className={className}
      placement={placement}
      offset={offset}
      crossOffset={crossOffset}
      {...props}
    >
      <SelectList>{children}</SelectList>
    </SelectPopover>
  )
}

function SelectPopover({
  className,
  children,
  placement = "bottom start",
  offset = 4,
  crossOffset = 0,
  ...props
}: Omit<
  React.ComponentProps<typeof PopoverPrimitive>,
  "className" | "children"
> & {
  className?: string
  children?: React.ReactNode
}) {
  return (
    <PopoverPrimitive
      data-slot="select-content"
      placement={placement}
      offset={offset}
      crossOffset={crossOffset}
      className={cn(
        // Theme: opaque Callit CREAM panel with ink text. The popover portals
        // to document.body, whose `--background` flips to #0a0a0a under
        // prefers-color-scheme: dark — so the surface colour is hardcoded, never
        // inherited. Ink ring + warm shadow lift it off the cream page.
        // The plugin-dependent `data-entering:*` animation classes were dropped
        // (no tailwindcss-animate in this project); `max-h-72` makes long lists
        // scroll instead of overflowing the viewport (Phase 2 degradation).
        "relative isolate z-50 max-h-72 w-(--trigger-width) min-w-36 origin-(--trigger-anchor-point) overflow-hidden rounded-xl bg-[#FFF2DD] text-[#2D1C00] shadow-[0_16px_40px_rgba(45,28,0,0.18)] ring-1 ring-[#2D1C00]/15",
        className
      )}
      {...props}
    >
      {children}
    </PopoverPrimitive>
  )
}

function SelectList<T extends object>({
  className,
  ...props
}: ListBoxProps<T>) {
  return (
    <ListBoxPrimitive
      data-slot="select-list"
      className={cn(
        "group/select-list max-h-[inherit] overflow-x-hidden overflow-y-auto p-1 outline-hidden",
        className
      )}
      {...props}
    />
  )
}

function SelectInput({ className, ...props }: SearchFieldProps) {
  return (
    <SearchField
      {...props}
      autoFocus
      data-slot="select-input-wrapper"
      className={cn("block p-1 pb-0", className)}
    >
      {/* Themed inline (no input-group): the kit's other ui/* parts rely on
          shadcn tokens this project does not define. The Input still binds to
          SearchField's react-aria context, so a11y/props are unchanged. */}
      <div className="flex items-center gap-2 rounded-lg bg-[#2D1C00]/5 px-3 py-2 ring-1 ring-[#2D1C00]/10 focus-within:ring-2 focus-within:ring-[#2D1C00]/30">
        <SearchIcon className="size-4 shrink-0 text-[#2D1C00]/45" />
        <InputPrimitive
          data-slot="select-input"
          className="w-full bg-transparent text-sm font-medium tracking-tight text-[#2D1C00] outline-none placeholder:text-[#2D1C00]/35 [&::-webkit-search-cancel-button]:hidden"
        />
      </div>
    </SearchField>
  )
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof HeaderPrimitive>) {
  return (
    <HeaderPrimitive
      data-slot="select-label"
      className={cn(
        "px-1.5 py-1 font-tusker-6700 text-[11px] font-medium uppercase tracking-[0.18em] text-[#2D1C00]/45",
        className
      )}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ListBoxItemPrimitive>) {
  return (
    <ListBoxItemPrimitive
      data-slot="select-item"
      textValue={typeof children === "string" ? children : undefined}
      className={cn(
        // Phase 3: data-focused/data-hovered map to a Callit ink wash; the
        // selected row keeps a check affordance instead of a colour block.
        "relative flex w-full cursor-pointer items-center gap-1.5 rounded-md py-1.5 pr-8 pl-2 text-sm text-[#2D1C00] outline-hidden select-none data-hovered:bg-[#2D1C00]/5 data-focused:bg-[#2D1C00]/5 data-focused:text-[#2D1C00] data-selected:font-medium data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className
      )}
      {...props}
    >
      {composeRenderProps(children, (children, { isSelected }) => (
        <>
          <span className="flex flex-1 shrink-0 gap-2 whitespace-nowrap">
            {children}
          </span>
          <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
            {isSelected ? <CheckIcon className="pointer-events-none" /> : null}
          </span>
        </>
      ))}
    </ListBoxItemPrimitive>
  )
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive>) {
  return (
    <SeparatorPrimitive
      data-slot="select-separator"
      className={cn("pointer-events-none -mx-1 my-1 h-px bg-[#2D1C00]/10", className)}
      {...props}
    />
  )
}

function SelectEmpty({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="select-empty"
      className={cn(
        "hidden w-full justify-center py-2 text-center text-sm text-[#2D1C00]/50 group-data-empty/select-list:flex",
        className
      )}
      {...props}
    />
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectInput,
  SelectItem,
  SelectLabel,
  SelectList,
  SelectPopover,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  SelectEmpty,
}
