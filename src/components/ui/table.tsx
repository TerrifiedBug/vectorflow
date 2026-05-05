"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

type Density = "compact" | "comfortable" | "dense"

const TableDensityContext = React.createContext<Density>("comfortable")

function Table({
  className,
  density = "comfortable",
  ...props
}: React.ComponentProps<"table"> & { density?: Density }) {
  return (
    <TableDensityContext.Provider value={density}>
      <div
        data-slot="table-container"
        className="relative w-full overflow-x-auto"
      >
        <table
          data-slot="table"
          data-density={density}
          className={cn("w-full caption-bottom text-[12px]", className)}
          {...props}
        />
      </div>
    </TableDensityContext.Provider>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("bg-bg-1 [&_tr]:border-b [&_tr]:border-line-2 sticky top-0 z-10", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "bg-bg-1 border-t border-line font-medium [&>tr]:last:border-b-0",
        className,
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "hover:bg-bg-3/50 data-[state=selected]:bg-accent-soft border-b border-line transition-colors",
        className,
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  const density = React.useContext(TableDensityContext)
  return (
    <th
      data-slot="table-head"
      className={cn(
        "text-fg-2 font-mono uppercase tracking-[0.04em] text-[10px] font-medium text-left align-middle whitespace-nowrap",
        density === "compact" ? "h-6 px-3" : density === "dense" ? "h-7 px-3" : "h-8 px-3",
        "[&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className,
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  const density = React.useContext(TableDensityContext)
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "align-middle whitespace-nowrap text-fg",
        density === "compact" ? "py-1 px-3" : density === "dense" ? "py-1.5 px-3" : "py-2.5 px-3",
        "[&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className,
      )}
      {...props}
    />
  )
}

function TableCellMono({ className, ...props }: React.ComponentProps<"td">) {
  return <TableCell className={cn("font-mono", className)} {...props} />
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("text-fg-2 mt-4 text-[12px]", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCellMono,
  TableCaption,
}
