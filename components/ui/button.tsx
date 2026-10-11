import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  /* ⚠️ 圆角：rounded-xl(12px) → var(--radius-sm)(6px)。
     原来按钮 12px、输入框 12px、卡片 16px —— 三者只差 4px，
     等于**没有层次**，这正是「全都一样」的模板感来源。
     现在按钮 6px / 输入框 6px / 卡片 16px，差 10px，一眼能分出控件与容器。 */
  /* transform 也在过渡列表里 —— 按下时的 scale 需要跟着动，否则手感是"跳"的。 */
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-sm)] text-sm font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-[var(--motion-fast)] ease-[var(--motion-ease-out)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        /* ⚠️ 原来是 shadow-lg + shadow-primary/25（品牌色外发光）+ hover:brightness-110。
           两条都在 AI 味禁用表上：
             - 品牌色外发光 = "这颗按钮会发光"，而投影的职责是表达悬浮高度；
             - brightness 提亮 =  cheapest 的 hover 写法，渐变底上尤其脏，
               等于拿整块画面当调色盘。
           改成**投影抬升**：hover 时 --shadow-2 → --shadow-3，
           active 时压回去 + 缩 2%。反馈是物理的，不是滤镜。 */
        default:
          "brand-gradient text-primary-foreground shadow-[var(--shadow-2)] hover:shadow-[var(--shadow-3)] active:scale-[0.98] active:shadow-[var(--shadow-1)]",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-input bg-background/60 hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        /* 圆角随尺寸走：小按钮 6px，大按钮 10px。同一族控件内部也保留梯度，
           而不是一个 rounded-xl 套所有尺寸。 */
        sm: "h-9 rounded-[var(--radius-sm)] px-3",
        lg: "h-11 rounded-[var(--radius-md)] px-6 text-[15px]",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
